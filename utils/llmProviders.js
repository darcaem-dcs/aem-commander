const logger = require('./log.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, { retries = 2, label = 'LLM' } = {}) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const status = Number(err.status || err.code) || 0;
            const netErr = /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|network error|aborted/i.test(err.message || '');
            const retryable = err.retryable || netErr || [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
            // A long Retry-After means a quota (e.g. free-tier daily limit): do not sit and wait.
            if (!retryable || attempt >= retries || (err.retryAfterMs && err.retryAfterMs > 45000)) throw err;
            const wait = Math.min(err.retryAfterMs || 2000 * Math.pow(2, attempt), 30000);
            logger.warn(`[${label}] ${err.message} -> retrying in ${Math.round(wait / 1000)}s (${attempt + 1}/${retries})`);
            await sleep(wait);
        }
    }
}

// JSON-Schema (lower-case) -> Gemini responseSchema (upper-case types, no additionalProperties)
function toGeminiSchema(s) {
    if (Array.isArray(s)) return s.map(toGeminiSchema);
    if (!s || typeof s !== 'object') return s;
    const out = {};
    for (const [k, v] of Object.entries(s)) {
        if (k === 'additionalProperties') continue;
        if (k === 'type' && typeof v === 'string') out.type = v.toUpperCase();
        else if (k === 'properties') {
            out.properties = {};
            for (const [pk, pv] of Object.entries(v)) out.properties[pk] = toGeminiSchema(pv);
        } else out[k] = toGeminiSchema(v);
    }
    return out;
}

// thinking: off | low | medium | high | default
function geminiThinkingConfig(model, level, genai) {
    if (!level || level === 'default') return null;
    if (/gemini-2\.5/.test(model)) {
        const budgets = { off: 0, low: 512, medium: 2048, high: 8192 };
        let b = budgets[level];
        if (b === undefined) return null;
        if (/pro/.test(model) && b === 0) b = 128;      // Pro models cannot disable thinking
        return { thinkingBudget: b };
    }
    const levels = { off: 'MINIMAL', low: 'LOW', medium: 'MEDIUM', high: 'HIGH' };
    const l = levels[level];
    if (!l) return null;
    return { thinkingLevel: (genai && genai.ThinkingLevel && genai.ThinkingLevel[l]) || l };
}

class GeminiProvider {
    constructor({ authMethod, credential }) {
        this.authMethod = authMethod;
        this.credential = credential;
        this.client = null;
        this.thinkingBroken = {};
    }

    _init() {
        if (this.client) return;
        const fs = require('fs');
        const genai = require('@google/genai');
        this.genai = genai;
        if (this.authMethod === 'vertex') {
            let projectId = '';
            try {
                projectId = JSON.parse(fs.readFileSync(this.credential, 'utf8')).project_id;
            } catch (err) {
                logger.error('Error reading project_id', err);
            }
            process.env.GOOGLE_APPLICATION_CREDENTIALS = this.credential;
            process.env.GOOGLE_CLOUD_PROJECT = projectId;
            process.env.GOOGLE_CLOUD_LOCATION = 'global';
            this.client = new genai.GoogleGenAI({ vertexai: true, project: projectId, location: 'global' });
        } else {
            this.client = new genai.GoogleGenAI({ apiKey: this.credential });
        }
    }

    async generate({ model, system, user, schema, thinking, maxTokens, temperature }) {
        this._init();
        const { HarmCategory, HarmBlockThreshold } = this.genai;
        const config = {
            systemInstruction: system,
            temperature: temperature ?? 0.1,
            maxOutputTokens: maxTokens || 4096,
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(schema)
        };
        if (HarmCategory && HarmBlockThreshold) {
            config.safetySettings = ['HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_DANGEROUS_CONTENT',
                'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_HARASSMENT']
                .map(c => ({ category: HarmCategory[c], threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }));
        }
        const tc = this.thinkingBroken[model] ? null : geminiThinkingConfig(model, thinking, this.genai);
        if (tc) config.thinkingConfig = tc;

        const call = () => this.client.models.generateContent({ model, contents: user, config });
        let res;
        try {
            res = await withRetry(call, { label: 'Gemini' });
        } catch (err) {
            if (config.thinkingConfig && /think/i.test(err.message || '')) {
                logger.warn(`Model ${model} rejected the thinking config (${err.message}). Retrying without it.`);
                this.thinkingBroken[model] = true;
                delete config.thinkingConfig;
                res = await withRetry(call, { label: 'Gemini' });
            } else throw err;
        }
        const u = res.usageMetadata || {};
        return {
            text: res.text || '',
            usage: {
                input: u.promptTokenCount || 0,
                output: u.candidatesTokenCount || 0,
                thinking: u.thoughtsTokenCount || 0,
                cached: u.cachedContentTokenCount || 0
            }
        };
    }
}

// Any OpenAI-compatible /chat/completions endpoint: Groq, OpenRouter, Ollama, LM Studio, DeepSeek...
class OpenAICompatProvider {
    constructor({ baseUrl, apiKey, jsonMode, timeoutMs }) {
        this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
        this.apiKey = apiKey || '';
        this.jsonMode = jsonMode || 'object';         // schema | object | none
        this.timeoutMs = timeoutMs || 120000;
        this.noReasoning = false;
    }

    _body({ model, system, user, schema, maxTokens, temperature, thinking }) {
        const hint = this.jsonMode !== 'schema'
            ? `\n\nRespond with ONLY a JSON object that conforms to this JSON Schema:\n${JSON.stringify(schema)}` : '';
        const body = {
            model,
            temperature: temperature ?? 0.1,
            max_tokens: maxTokens || 4096,
            messages: [{ role: 'system', content: system + hint }, { role: 'user', content: user }]
        };
        if (this.jsonMode === 'schema') body.response_format = { type: 'json_schema', json_schema: { name: 'commander_orders', schema } };
        else if (this.jsonMode === 'object') body.response_format = { type: 'json_object' };
        if (!this.noReasoning && thinking && thinking !== 'default' && /gpt-oss|qwen3|deepseek-r1|reasoning|\bo[134]\b/i.test(model)) {
            body.reasoning_effort = thinking === 'off' ? 'low' : thinking;
        }
        return body;
    }

    async _post(body) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
        let res, text;
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
            res = await fetch(`${this.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
            text = await res.text();
        } catch (e) {
            const err = new Error(`network error: ${e.message}`);
            err.retryable = true;
            throw err;
        } finally {
            clearTimeout(timer);
        }
        if (!res.ok) {
            const err = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
            err.status = res.status;
            err.body = text;
            const ra = Number(res.headers.get('retry-after'));
            if (ra) err.retryAfterMs = ra * 1000;
            throw err;
        }
        return JSON.parse(text);
    }

    async generate(req) {
        let data;
        for (let adjust = 0; ; adjust++) {
            const body = this._body(req);
            try {
                data = await withRetry(() => this._post(body), { label: 'OpenAI-compat' });
                break;
            } catch (err) {
                // Auto-degrade features the endpoint/model does not support
                if (err.status === 400 && adjust < 3) {
                    if (body.reasoning_effort && /reasoning/i.test(err.body)) { this.noReasoning = true; continue; }
                    if (body.response_format && /response_format|json_schema|json_object/i.test(err.body)) {
                        this.jsonMode = this.jsonMode === 'schema' ? 'object' : 'none';
                        logger.warn(`Endpoint rejected response_format; falling back to jsonMode=${this.jsonMode}`);
                        continue;
                    }
                }
                throw err;
            }
        }
        const msg = data.choices && data.choices[0] && data.choices[0].message;
        const u = data.usage || {};
        return {
            text: ((msg && msg.content) || '').replace(/<think>[\s\S]*?<\/think>/g, ''),
            usage: {
                input: u.prompt_tokens || 0,
                output: (u.completion_tokens || 0) - ((u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0),
                thinking: (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0,
                cached: (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0
            }
        };
    }
}

module.exports = { GeminiProvider, OpenAICompatProvider, toGeminiSchema, geminiThinkingConfig, withRetry };
