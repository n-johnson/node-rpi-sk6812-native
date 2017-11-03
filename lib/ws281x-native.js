var EventEmitter = require('events').EventEmitter;

var ws281x = new EventEmitter();
var _isInitialized = false;
var _indexMapping = null;
var _outputBuffer = null;
var _useGammaCorrection = null;
var _rgbToRgbw = null;
var _gammaTable = new Uint8Array(256);

var bindings = getNativeBindings();

// ---- EXPORTED INTERFACE
var STRIP_TYPES = bindings.STRIP_TYPES;
ws281x.STRIP_TYPES = STRIP_TYPES;

function getNativeBindings() {
    var stub = {
        init: function () { },
        render: function () { },
        setBrightness: function () { },
        reset: function () { },
        STRIP_TYPES: {}
    };

    if (!process.getuid || process.getuid() !== 0) {
        console.warn('[rpi-sk6812-native] This module requires being run ' +
            'with root-privileges. A non-functional stub of the ' +
            'interface will be returned.');

        return stub;
    }

    // the native module might even be harmful (or won't work in the best case)
    // in the wrong environment, so we make sure that at least everything we can
    // test for matches the raspberry-pi before loading the native-module
    if (process.arch !== 'arm' && process.platform !== 'linux') {
        console.warn('[rpi-sk6812-native] It looks like you are not ' +
            'running on a raspberry pi. This module will not work ' +
            'on other platforms. A non-functional stub of the ' +
            'interface will be returned.');

        return stub;
    }

    // determine rapsberry-pi version based on SoC-family. (note: a more
    // detailed way would be to look at the revision-field from cpuinfo, see
    // http://elinux.org/RPi_HardwareHistory)
    var raspberryVersion = (function () {
        var cpuInfo = require('fs').readFileSync('/proc/cpuinfo').toString(),
            socFamily = cpuInfo.match(/hardware\s*:\s*(bcm[0-9]{4})/i);

        if (!socFamily) { return 0; }

        switch (socFamily[1].toLowerCase()) {
            case 'bcm2708':
            case 'bcm2835':
                return 1;
            case 'bcm2709':
                return 2;
            default: return 0;
        }
    }());

    if (raspberryVersion === 0) {
        console.warn('[rpi-sk6812-native] Could not verify raspberry-pi ' +
            'version. If this is wrong and you are running this on a ' +
            'raspberry-pi, please file a bug-report at ' +
            '  https://github.com/n-johnson/node-rpi-sk6812-native/issues\n' +
            'A non-functional stub of this modules interface will be ' +
            'returned.');

        return stub;
    }

    return require('./binding/rpi_ws281x.node');
}

/**
 * gamma-correction: remap color-values (provided as 0xwwrrbbgg) with a
 * gamma-factor. Gamma-value and formula are taken from
 * http://rgb-123.com/ws2812-color-output/
 *
 * @type function(number): number
 */
var gammaCorrect = (function () {
    var _gamma = 1 / 0.45;

    for (var i = 0; i < 256; i++) {
        _gammaTable[i] = Math.floor(Math.pow(i / 255, _gamma) * 255 + 0.5);
    }

    return function gammaCorrect(color) {
        return (
            (_gammaTable[color & 0xff]
                | (_gammaTable[(color >> 8) & 0xff] << 8)
                | (_gammaTable[(color >> 16) & 0xff] << 16)
                | (_gammaTable[(color >> 24) & 0xff] << 24)) >>> 0
        );
    };
}());


/**
 * remap pixel-positions according to the specified index-mapping.
 *
 * @type function(Uint32Array, Array.<Number>): Uint32Array
 */
var remap = (function () {
    var _tmpData = null;

    return function remap(data, indexMapping) {
        _tmpData = Uint32Array.from(data);

        for (var i = 0; i < data.length; i++) {
            data[i] = _tmpData[indexMapping[i]];
        }
    };
}());

var rgbToRgbw = (function () {
    return function rgbToRgbw(data) {
        for (var i = 0; i < data.length; i++) {
            let pixelIn = data[i];
            let rIn = (pixelIn >> 16) & 0xff;
            let gIn = (pixelIn >> 8) & 0xff;
            let bIn = pixelIn & 0xff;

            //Get the maximum between R, G, and B
            let tMax = Math.max(rIn, gIn, bIn);

            //If the maximum value is 0 continue
            if (tMax === 0) continue;

            //figure out what the color with 100% hue is
            let multiplier = 255 / tMax;
            let rHue = rIn * multiplier;
            let gHue = gIn * multiplier;
            let bHue = bIn * multiplier;

            //Whiteness
            let whiteness = ~~(((Math.max(rHue, gHue, bHue) 
                + Math.min(rHue, gHue, bHue)) / 2 - 127.5) 
                * 2 / multiplier);

            data[i] = ((whiteness << 24) | (rIn - whiteness) << 16 | (gIn - whiteness) << 8 | (bIn - whiteness)) >>> 0;
        }
    }
}());



/**
 * configures PWM and DMA for sending data to the LEDs
 *
 * @param {Number} numLeds  number of LEDs to be controlled
 * @param {?Object} options  (acutally only tested with default-values)
 *                           intialization-options for the library
 *                           (PWM frequency, DMA channel, GPIO, Brightness)
 */
ws281x.init = function (numLeds, options) {
    if (typeof options !== 'object') options = {};
    _isInitialized = true;
    _outputBuffer = new Buffer(4 * numLeds);
    _useGammaCorrection = !!options.gammaCorrection;
    _rgbToRgbw = !!options.rgbToRgbw && options.strip_type === ws281x.STRIP_TYPES.SK6812W;

    bindings.init(numLeds, options);
};


/**
 * register a mapping to manipulate array-indices within the
 * data-array before rendering.
 *
 * @param {Array.<Number>} mapping  the mapping, indexed by destination.
 */
ws281x.setIndexMapping = function (mapping) {
    _indexMapping = mapping;
};


/**
 * send data to the LED-strip.
 *
 * @param {Uint32Array} data  the pixel-data, 24(rgb) / 32(rgbw) bit per pixel in
 *                            (W)RGB-format (0x00ff0000 is red).
 * @return {Uint32Array} data as it was sent to the LED-strip
 */
ws281x.render = function (data) {
    if (!_isInitialized) {
        throw new Error('render called before initialization.');
    }

    this.emit('beforeRender', data);

    if (_indexMapping) {
        remap(data, _indexMapping);
    }

    if (_rgbToRgbw) {
        rgbToRgbw(data);
    }

    if (_useGammaCorrection) {
        data.map(gammaCorrect);
    }

    for (var i = 0; i < data.length; i++) {
        _outputBuffer.writeUInt32LE(data[i], 4 * i);
    }
    bindings.render(_outputBuffer);

    this.emit('render', data);

    return data;
};

ws281x.setBrightness = function (brightness, render) {
    if (!_isInitialized) {
        throw new Error('setBrightness called before initialization.');
    }

    if (_useGammaCorrection) {
        brightness = _gammaTable[brightness & 0xff];
    }

    bindings.setBrightness(brightness);
    // re-render to have the brightness applied
    if (render !== false) {
        bindings.render(_outputBuffer);
    }
};

/**
 * clears all LEDs, resets the PWM and DMA-parts and deallocates
 * all internal structures.
 */
ws281x.reset = function () {
    _isInitialized = false;
    _outputBuffer = null;

    bindings.reset();
};

module.exports = ws281x;
