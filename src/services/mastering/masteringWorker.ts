import { ProLimiter } from './dsp/fx/limiter';
import { MultibandCompressor } from './dsp/fx/multiband_compressor';
import { Saturation } from './dsp/fx/saturation';
import { StereoImager } from './dsp/fx/stereo_imager';
import { MasteringEQ } from './dsp/fx/mastering_eq';
import { DeEsser } from './dsp/fx/deesser';
import { TransientShaper } from './dsp/fx/transient_shaper';
import { Metering } from './dsp/fx/metering';
import { Reverb } from './dsp/fx/reverb';
import { BiquadFilter, dbToLinear } from './dsp/utils';

self.onmessage = async (e) => {
  const { id, data } = e.data;
  const { channels, sampleRate, settings } = data;

  if (!channels || !channels[0]) {
    self.postMessage({ id, success: false, error: 'No audio data provided' });
    return;
  }

  try {
    const limiter = new ProLimiter(sampleRate);
    const mbComp = new MultibandCompressor(sampleRate);
    const saturation = new Saturation(0);
    const imager = new StereoImager(sampleRate);
    const eq = new MasteringEQ(sampleRate);
    const deesser = new DeEsser(sampleRate);
    const shaper = new TransientShaper(sampleRate);
    const metering = new Metering(sampleRate);
    const reverb = new Reverb(sampleRate);

    limiter.setCeiling(settings.ceiling ?? -1);
    limiter.setTruePeakMode(!!settings.truePeakLimit);

    // Subsonic cleanup: high-pass at 30 Hz to remove rumble/infrasonic energy
    // that wastes headroom and muddies the low end (was a dead setting).
    const cleanLowEndFilter = new BiquadFilter();
    cleanLowEndFilter.setHighPass(30, 0.707, sampleRate);
    
    if (settings.tapeWarmth) {
        saturation.setDrive(2.0);
        saturation.setMix(0.4);
    } else {
        saturation.setMix(0);
    }

    imager.setWidth((settings.stereoWidth ?? 100) / 100);
    imager.setBassMono(!!settings.centerBass);
    
    if (settings.addPunch) {
        shaper.setAttack(2.0);
    } else {
        shaper.setAttack(0);
    }

    if (settings.deharsh) {
        deesser.setThreshold(-18);
        deesser.setRatio(2.5);
        deesser.setStrength(0.35);
        deesser.setMaxReduction(3);
    } else {
        deesser.setRatio(1);
    }
    
    if (settings.eq) {
      eq.setMidBand(0, 100, 0.7, settings.eq.low ?? 0);
      eq.setMidBand(1, 400, 1.0, settings.eq.lowMid ?? 0);
      eq.setMidBand(2, 1000, 1.0, settings.eq.mid ?? 0);
      eq.setMidBand(3, 4000, 1.0, settings.eq.highMid ?? 0);
      eq.setMidBand(4, 12000, 0.7, settings.eq.high ?? 0);
      
      if (settings.addAir) {
        eq.setHighShelf(15000, 0.707, 3.0);
      }
      if (settings.cutMud) {
        eq.setMidBand(1, 250, 2.0, -3.0);
      }
    }

    const inputGainLinear = dbToLinear(settings.inputGain ?? 0);
    const len = channels[0].length;
    const numChannels = channels.length;

    if (inputGainLinear !== 1.0) {
        for (let ch = 0; ch < numChannels; ch++) {
          for (let i = 0; i < len; i++) channels[ch][i] *= inputGainLinear;
        }
    }

    if (settings.cleanLowEnd) {
        for (let ch = 0; ch < numChannels; ch++) {
          for (let i = 0; i < len; i++) channels[ch][i] = cleanLowEndFilter.process(channels[ch][i], ch);
        }
    }

    saturation.process(channels);
    eq.process(channels);
    
    if (settings.glueCompression) {
        mbComp.process(channels);
    }
    
    imager.process(channels);
    
    if (settings.addAir) {
      reverb.setMix(0.04);
      reverb.process(channels);
    }

    if (settings.deharsh) {
        deesser.process(channels);
    }
    
    if (settings.addPunch) {
        shaper.process(channels);
    }

    let measuredLufs: number | undefined;

    if (settings.normalizeLoudness || settings.autoLevel) {
      metering.reset();
      metering.process(channels);
      const currentLufs = metering.getLufs();
      measuredLufs = currentLufs;
      const targetLufs = settings.targetLufs || -14;
      const gainRequired = dbToLinear(targetLufs - currentLufs);
      
      const safeGain = Math.min(gainRequired, dbToLinear(12));
      
      if (Math.abs(safeGain - 1.0) > 0.001) {
          for (let ch = 0; ch < numChannels; ch++) {
            for (let i = 0; i < len; i++) channels[ch][i] *= safeGain;
          }
      }
    }

    limiter.process(channels);

    // Re-measure after limiting: captures post-limit true peak + final LUFS.
    metering.reset();
    metering.process(channels);
    if (measuredLufs == null) {
      measuredLufs = metering.getLufs();
    }
    const measuredTruePeak = metering.getTruePeakDb();

    self.postMessage(
      { id, success: true, result: { channels, measuredLufs, measuredTruePeak } },
      channels.map((c: Float32Array) => c.buffer)
    );
  } catch (err: any) {
    self.postMessage({ id, success: false, error: err.message || 'Unknown DSP processing error' });
  }
};
