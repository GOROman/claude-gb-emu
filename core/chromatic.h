// ModRetro Chromatic FM expansion: YM2151 + MSM6258 ADPCM at $FF28-$FF2F.
// Register map follows oss-chromatic-console-fpga chromatic_fm_io.v:
//   FF28  YM2151 address latch
//   FF29  YM2151 data (write-only; performs the register write)
//   FF2A  read: status (bit7 YM busy, bit6 ADPCM FIFO ready, bit5 playing)
//         write: ADPCM FIFO data byte (accepted only while the FIFO is ready)
//   FF2B  control: bit0 YM enable, bit1 GB APU enable, bit2 ADPCM enable,
//         bit3 ADPCM playback by edge (0->1 start, 1->0 stop),
//         bits7:4 ADPCM volume
//   FF2C/FF2D  YM left/right volume ($80 = reference level)
//   FF2E  expansion ID $51,  FF2F  version $04 (dedicated ADPCM port)
#pragma once
#include <cstdint>

namespace gb {

struct ChromaticFM {
    bool enabled = false;          // FM button on the frontend

    uint8_t ymAddrLatch = 0;
    uint8_t audioControl = 0x03;   // bit0 YM, bit1 GB APU, bit2 ADPCM
    uint8_t volumeLeft = 0x80, volumeRight = 0x80;
    uint8_t adpcmVolume = 8;

    // MSM6258 (OKI 4-bit ADPCM), 15625 Hz mono, 256-byte FIFO
    uint8_t fifo[256];
    int fifoRd = 0, fifoWr = 0, fifoCount = 0;
    bool adpcmActive = false, nibbleHi = false;
    int adpcmSignal = 0, adpcmStep = 0;
    double adpcmAcc = 0;
    float adpcmOut = 0;

    // YM2151 via ymfm (3.579545 MHz -> 55930.4 Hz sample rate)
    void* opm = nullptr;
    double ymAcc = 0;
    float ymL = 0, ymR = 0;

    ~ChromaticFM();
    void reset();
    uint8_t read(uint8_t reg);          // reg = io - 0x28 (0..7)
    void write(uint8_t reg, uint8_t v);
    // advance generators to produce the next output sample (called per
    // host-rate audio sample); results land in ymL/ymR/adpcmOut
    void generateSample(double sampleRate);

private:
    void adpcmDecodeNibble();
    void adpcmStart();
    void adpcmStop();
};

} // namespace gb
