var ws281x = require('../index.js');

var NUM_LEDS = parseInt(process.argv[2], 10) || 10,
    pixelData = new Uint32Array(NUM_LEDS);

ws281x.init(NUM_LEDS, {
    strip_type: ws281x.STRIP_TYPES.SK6812W,
    brightness: 255
});

// ---- trap the SIGINT and reset before exit
process.on('SIGINT', function () {
    ws281x.reset();
    process.nextTick(function () { process.exit(0); });
});

pixelData.fill(0xff000000);

ws281x.render(pixelData);

// ---- animation-loop
var t0 = Date.now();
setInterval(function () {
    var dt = Date.now() - t0;

    ws281x.setBrightness(
        Math.floor(Math.sin(dt/1000) * 128 + 128));
}, 1000 / 60);

console.log('Press <ctrl>+C to exit.');
