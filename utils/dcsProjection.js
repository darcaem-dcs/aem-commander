// DCS (x = north, y = east, metres) -> WGS84 lat/lon via inverse Transverse Mercator.
// Constants per theatre (from pydcs). Verify visually: AEM_RES statics must sit on airbases.
const THEATRES = {
    Caucasus:       { cm: 33,   fe: -99516.9999999732,  fn: -4998114.999999984 },
    Nevada:         { cm: -115, fe: -0.0,                fn: -4410028.063999966 },
    Normandy:       { cm: -3,   fe: -195526.00000000204, fn: -5484812.999999951 },
    PersianGulf:    { cm: 57,   fe: 75755.99999999645,   fn: -2894933.0000000377 },
    TheChannel:     { cm: 3,    fe: 99376.00000000288,   fn: -5636889.00000001 },
    Syria:          { cm: 39,   fe: 282801.00000000164,  fn: -3879865.9999999935 },
    MarianaIslands: { cm: 147,  fe: 238417.99999999112,  fn: -1491840.000000048 },
    SinaiMap:       { cm: 33,   fe: 169221.9999999585,   fn: -3325312.00000003 },
    Kola:           { cm: 21,   fe: -62702.00000000019,  fn: -7543624.999999979 },
    Afghanistan:    { cm: 63,   fe: -300150.9999999992,  fn: -3759657.000000045 },
    Iraq:           { cm: 45,   fe: 72290.00000000224,   fn: -3680057.9999999925 },
    GermanyCW:      { cm: 21,   fe: 35427.63999999978,   fn: -6061633.123999998 }
    // SouthAtlantic: TODO (constants not verified)
};

const A = 6378137, F = 1 / 298.257223563, K0 = 0.9996;
const E2 = F * (2 - F), EP2 = E2 / (1 - E2);
const RAD = Math.PI / 180;

function hasProjection(theatre) { return !!THEATRES[theatre]; }

function xyToLatLon(theatre, x, y) {
    const t = THEATRES[theatre];
    if (!t || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const E = y - t.fe, N = x - t.fn;

    const mu = (N / K0) / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256));
    const s = Math.sqrt(1 - E2), e1 = (1 - s) / (1 + s);
    const phi1 = mu
        + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
        + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
        + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
        + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);

    const sin = Math.sin(phi1), cos = Math.cos(phi1), tan = Math.tan(phi1);
    const C1 = EP2 * cos * cos, T1 = tan * tan;
    const N1 = A / Math.sqrt(1 - E2 * sin * sin);
    const R1 = A * (1 - E2) / Math.pow(1 - E2 * sin * sin, 1.5);
    const D = E / (N1 * K0);

    const lat = phi1 - (N1 * tan / R1) * (D * D / 2
        - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24
        + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720);
    const lon = t.cm * RAD + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
        + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120) / cos;

    return { lat: lat / RAD, lon: lon / RAD };
}

module.exports = { xyToLatLon, hasProjection };