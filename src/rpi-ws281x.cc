#include <nan.h>
#include <v8.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <algorithm>

extern "C" {
  #include "rpi_ws281x/ws2811.h"
}

using namespace v8;

#define DEFAULT_TARGET_FREQ     800000
#define DEFAULT_GPIO_PIN        18
#define DEFAULT_DMANUM          5
#define DEFAULT_INVERT          0
#define DEFAULT_COUNT           0
#define DEFAULT_BRIGHTNESS      24
#define DEFAULT_LED_STRIP       WS2812_STRIP

ws2811_t ledstring;
ws2811_channel_t
  channel0data;


/**
 * exports.render(Uint32Array data) - sends the data to the LED-strip,
 *   if data is longer than the number of leds, remaining data will be ignored.
 *   Otherwise, data
 */
void render(const Nan::FunctionCallbackInfo<v8::Value>& info) {
  if(info.Length() != 1) {
    Nan::ThrowTypeError("render(): missing argument.");
    return;
  }

  if(!node::Buffer::HasInstance(info[0])) {
    Nan::ThrowTypeError("render(): expected argument to be a Buffer.");
    return;
  }

  Local<Object> buffer = info[0]->ToObject();

  int numBytes = std::min((int)node::Buffer::Length(buffer),
      4 * ledstring.channel[0].count);

  uint32_t* data = (uint32_t*) node::Buffer::Data(buffer);
  memcpy(ledstring.channel[0].leds, data, numBytes);

  ws2811_render(&ledstring);

  info.GetReturnValue().SetUndefined();
}


/**
 * exports.init(Number ledCount [, Object config]) - setup the configuration and initialize the library.
 */
void init(const Nan::FunctionCallbackInfo<v8::Value>& info) {
  ledstring.freq    = DEFAULT_TARGET_FREQ;
  ledstring.dmanum  = DEFAULT_DMANUM;

  channel0data.gpionum = DEFAULT_GPIO_PIN;
  channel0data.invert = DEFAULT_INVERT;
  channel0data.count = DEFAULT_COUNT;
  channel0data.brightness = DEFAULT_BRIGHTNESS;
  channel0data.strip_type = DEFAULT_LED_STRIP;

  ledstring.channel[0] = channel0data;

  if(info.Length() < 1) {
    return Nan::ThrowTypeError("init(): expected at least 1 argument");
  }

  // first argument is a number
  if(!info[0]->IsNumber()) {
    return Nan::ThrowTypeError("init(): argument 0 is not a number");
  }

  ledstring.channel[0].count = info[0]->Int32Value();

  // second (optional) an Object
  if(info.Length() >= 2 && info[1]->IsObject()) {
    Local<Object> config = info[1]->ToObject();

    Local<String>
        symFreq = Nan::New<String>("frequency").ToLocalChecked(),
        symDmaNum = Nan::New<String>("dmaNum").ToLocalChecked(),
        symGpioPin = Nan::New<String>("gpioPin").ToLocalChecked(),
        symInvert = Nan::New<String>("invert").ToLocalChecked(),
        symBrightness = Nan::New<String>("brightness").ToLocalChecked(),
        symStripType = Nan::New<String>("strip_type").ToLocalChecked();

    if(Nan::HasOwnProperty(config, symFreq).ToChecked()) {
      ledstring.freq = config->Get(symFreq)->Uint32Value();
    }

    if(Nan::HasOwnProperty(config, symDmaNum).ToChecked()) {
      ledstring.dmanum = config->Get(symDmaNum)->Int32Value();
    }

    if(Nan::HasOwnProperty(config, symGpioPin).ToChecked()) {
      ledstring.channel[0].gpionum = config->Get(symGpioPin)->Int32Value();
    }

    if(Nan::HasOwnProperty(config, symInvert).ToChecked()) {
      ledstring.channel[0].invert = config->Get(symInvert)->Int32Value();
    }

    if(Nan::HasOwnProperty(config, symBrightness).ToChecked()) {
      ledstring.channel[0].brightness = config->Get(symBrightness)->Int32Value();
    }

    if(Nan::HasOwnProperty(config, symStripType).ToChecked()) {
      ledstring.channel[0].strip_type = config->Get(symStripType)->Int32Value();
    }
  }

  // FIXME: handle errors, throw JS-Exception
  int err = ws2811_init(&ledstring);

  if(err) {
      return Nan::ThrowError("init(): initialization failed. sorry – no idea why.");
  }
  info.GetReturnValue().SetUndefined();
}


/**
 * exports.setBrightness()
 */
void setBrightness(const Nan::FunctionCallbackInfo<v8::Value>& info) {
  if(info.Length() != 1) {
      return Nan::ThrowError("setBrightness(): no value given");
  }

  // first argument is a number
  if(!info[0]->IsNumber()) {
    return Nan::ThrowTypeError("setBrightness(): argument 0 is not a number");
  }

  ledstring.channel[0].brightness = info[0]->Int32Value();

  info.GetReturnValue().SetUndefined();
}


/**
 * exports.reset() – blacks out the LED-strip and finalizes the library
 * (disable PWM, free DMA-pages etc).
 */
void reset(const Nan::FunctionCallbackInfo<v8::Value>& info) {
  memset(ledstring.channel[0].leds, 0, sizeof(*ledstring.channel[0].leds) * ledstring.channel[0].count);

  ws2811_render(&ledstring);
  ws2811_wait(&ledstring);
  ws2811_fini(&ledstring);

  info.GetReturnValue().SetUndefined();
}


/**
 * initializes the module.
 */
void initialize(Handle<Object> exports) {
  NAN_EXPORT(exports, init);
  NAN_EXPORT(exports, reset);
  NAN_EXPORT(exports, render);
  NAN_EXPORT(exports, setBrightness);

  v8::Local<v8::Object> stripTypes = Nan::New<v8::Object>();
  Nan::Set(stripTypes, v8::String::NewFromUtf8(Nan::GetCurrentContext()->GetIsolate(), "WS2812"), Nan::New((int)WS2812_STRIP));
  Nan::Set(stripTypes, v8::String::NewFromUtf8(Nan::GetCurrentContext()->GetIsolate(), "SK6812"), Nan::New((int)SK6812_STRIP));
  Nan::Set(stripTypes, v8::String::NewFromUtf8(Nan::GetCurrentContext()->GetIsolate(), "SK6812W"), Nan::New((int)SK6812W_STRIP));

  // exports.STRIP_TYPES = {
  //   WS2812: 0x00,
  //   ...
  // }
  Nan::Set(exports, v8::String::NewFromUtf8(Nan::GetCurrentContext()->GetIsolate(), "STRIP_TYPES"), stripTypes);
}

NODE_MODULE(rpi_ws281x, initialize)
