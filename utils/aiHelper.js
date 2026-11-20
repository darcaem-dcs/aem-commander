const logger = require('./log.js');
const { GeminiProvider, OpenAICompatProvider } = require('./llmProviders.js');
const { ORDER_SCHEMA } = require('./orderSchema.js');

// Thin facade: provider creation + one-shot structured generation + tolerant JSON parsing.
// (The old multi-round tool-calling chat session was removed: it re-sent the whole history on every round.)
module.exports = function () {

    this.createProvider = function (opts) {
        if (opts.provider === 'openai') {
            return new OpenAICompatProvider({ baseUrl: opts.baseUrl, apiKey: opts.apiKey, jsonMode: opts.jsonMode });
        }
        const g = opts.gemini || {};
        return new GeminiProvider({ authMethod: g.authMethod || 'apikey', credential: g.credential });
    };

    this.generateOrders = async function (provider, req) {
        const { text, usage } = await provider.generate({ ...req, schema: ORDER_SCHEMA });
        return { json: this.aiSanitizeJson(text), text, usage };
    };

    this.aiSanitizeJson = function (input) {
        if (!input) return null;
        try {
            return JSON.parse(input);
        } catch (err1) {
            const sanitized = input.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json/g, '').replace(/```/g, '').trim();
            try {
                return JSON.parse(sanitized);
            } catch (err2) {
                const m = sanitized.match(/\{[\s\S]*\}/);
                if (m) {
                    try { return JSON.parse(m[0]); } catch (err3) { /* fall through */ }
                }
                logger.info('--- JSON cleanup failed:', sanitized.slice(0, 500));
                return null;
            }
        }
    };
};
