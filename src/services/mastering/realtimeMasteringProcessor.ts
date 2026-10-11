import { MasteringSettings } from '../offlineDb';
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

export class RealtimeMasteringProcessor {
  private settings: MasteringSettings;
  private limiter: ProLimiter;
  private safetyLimiter: ProLimiter;
  private mbComp: MultibandCompressor;
  private saturation: Saturation;
  private imager: StereoImager;
  private eq: MasteringEQ;
  private deesser: DeEsser;
  private shaper: TransientShaper;
  private metering: Metering;
  private telemetryMeter: Metering;
  private reverb: Reverb;
  private blockCounter = 0;
  private rollingRms = -24;
  private loudnessGainLinear = 1;
  private cleanLowEndFilter = new BiquadFilter();
  private readonly onTelemetry?: (data: { lufs: number; rmsDb: number; truePeakDb: number; shortTermLufs: number }) => void;

  constructor(sampleRate: number, settings: MasteringSettings, onTelemetry?: (data: { lufs: number; rmsDb: number; truePeakDb: number; shortTermLufs: number }) => void) {
    this.settings = settings;
    this.onTelemetry = onTelemetry;
    this.limiter = new ProLimiter(sampleRate);
    this.safetyLimiter = new ProLimiter(sampleRate);
    this.mbComp = new MultibandCompressor(sampleRate);
    this.saturation = new Saturation(0);
    this.imager = new StereoImager(sampleRate);
    this.eq = new MasteringEQ(sampleRate);
    this.deesser = new DeEsser(sampleRate);
    this.shaper = new TransientShaper(sampleRate);
    this.metering = new Metering(sampleRate);
    this.telemetryMeter = new Metering(sampleRate);
    this.reverb = new Reverb(sampleRate);
    this.cleanLowEndFilter.setHighPass(30, 0.707, sampleRate);
    this.configureFx();
  }

  setSettings(settings: MasteringSettings) {
    this.settings = settings;
    this.configureFx();
  }

  private configureFx() {
    const settings = this.settings;
    this.limiter.setCeiling(settings.ceiling ?? -1);
    this.limiter.setRelease(0.05);
    this.limiter.setTruePeakMode(!!settings.truePeakLimit);
    this.safetyLimiter.setCeiling(-0.5);
    this.safetyLimiter.setRelease(0.05);
    this.safetyLimiter.setTruePeakMode(false);

    if (settings.tapeWarmth) {
      this.saturation.setDrive(2.0);
      this.saturation.setMix(0.25);
    } else {
      this.saturation.setDrive(0);
      this.saturation.setMix(0);
    }

    this.imager.setWidth((settings.stereoWidth ?? 100) / 100);
    this.imager.setBassMono(!!settings.centerBass);

    if (settings.addPunch) {
      this.shaper.setAttack(1.5);
    } else {
      this.shaper.setAttack(0);
    }
    this.shaper.setSustain(0);

    if (settings.deharsh) {
      this.deesser.setThreshold(-18);
      this.deesser.setRatio(2.5);
      this.deesser.setStrength(0.35);
      this.deesser.setMaxReduction(3);
    } else {
      this.deesser.setRatio(1);
      this.deesser.setStrength(0);
      this.deesser.setMaxReduction(0);
    }

    const eq = settings.eq;
    this.eq.setMidBand(0, 100, 0.7, eq.low ?? 0);
    this.eq.setMidBand(1, 400, 1.0, eq.lowMid ?? 0);
    this.eq.setMidBand(2, 1000, 1.0, eq.mid ?? 0);
    this.eq.setMidBand(3, 4000, 1.0, eq.highMid ?? 0);
    this.eq.setMidBand(4, 12000, 0.7, eq.high ?? 0);
    this.eq.setHighShelf(15000, 0.707, settings.addAir ? 3.0 : 0);

    if (settings.cutMud) {
      this.eq.setMidBand(1, 250, 2.0, -3.0);
    }

    this.reverb.setMix(settings.addAir ? 0.04 : 0);
  }

  private computeRmsDb(channels: Float32Array[]) {
    if (!channels.length || !channels[0].length) return -144;
    let sum = 0;
    let count = 0;
    for (let ch = 0; ch < channels.length; ch++) {
      const channel = channels[ch];
      for (let i = 0; i < channel.length; i++) {
        sum += channel[i] * channel[i];
        count++;
      }
    }
    const rms = Math.sqrt(sum / Math.max(1, count));
    return rms > 0 ? 20 * Math.log10(rms) : -144;
  }

  process(inputBuffer: AudioBuffer, outputBuffer: AudioBuffer) {
    const channelCount = outputBuffer.numberOfChannels;
    const channels: Float32Array[] = [];

    for (let ch = 0; ch < channelCount; ch++) {
      const out = outputBuffer.getChannelData(ch);
      const input = inputBuffer.getChannelData(Math.min(ch, inputBuffer.numberOfChannels - 1));
      out.set(input);
      channels.push(out);
    }

    const inputGainLinear = dbToLinear(this.settings.inputGain ?? 0);
    if (inputGainLinear !== 1) {
      for (let ch = 0; ch < channels.length; ch++) {
        for (let i = 0; i < channels[ch].length; i++) {
          channels[ch][i] *= inputGainLinear;
        }
      }
    }

    if (this.settings.cleanLowEnd) {
      for (let ch = 0; ch < channels.length; ch++) {
        for (let i = 0; i < channels[ch].length; i++) {
          channels[ch][i] = this.cleanLowEndFilter.process(channels[ch][i], ch);
        }
      }
    }

    this.saturation.process(channels);
    this.eq.process(channels);

    if (this.settings.glueCompression) {
      this.mbComp.process(channels);
    }

    this.imager.process(channels);

    if (this.settings.addAir) {
      this.reverb.process(channels);
    }

    if (this.settings.deharsh) {
      this.deesser.process(channels);
    }

    if (this.settings.addPunch) {
      this.shaper.process(channels);
    }

    if (this.settings.normalizeLoudness || this.settings.autoLevel) {
      this.metering.process(channels);
      const currentLufs = this.metering.getShortTermLufs();
      const targetLufs = this.settings.targetLufs ?? -14;
      if (Number.isFinite(currentLufs)) {
        const desiredGain = dbToLinear(Math.max(-4, Math.min(4, targetLufs - currentLufs)));
        this.loudnessGainLinear += (desiredGain - this.loudnessGainLinear) * 0.08;
      }
      for (let ch = 0; ch < channels.length; ch++) {
        for (let i = 0; i < channels[ch].length; i++) {
          channels[ch][i] *= this.loudnessGainLinear;
        }
      }
    } else {
      this.loudnessGainLinear += (1 - this.loudnessGainLinear) * 0.12;
    }

    if (this.settings.truePeakLimit) {
      this.limiter.process(channels);
    } else {
      this.safetyLimiter.process(channels);
    }

    for (let ch = 0; ch < channels.length; ch++) {
      for (let i = 0; i < channels[ch].length; i++) {
        const sample = channels[ch][i];
        channels[ch][i] = Number.isFinite(sample) ? Math.max(-0.999, Math.min(0.999, sample)) : 0;
      }
    }

    this.telemetryMeter.process(channels);
    const rmsDb = this.computeRmsDb(channels);
    this.rollingRms = this.rollingRms * 0.92 + rmsDb * 0.08;
    this.blockCounter += 1;
    if (this.blockCounter % 24 === 0) {
      this.onTelemetry?.({
        lufs: this.telemetryMeter.getLufs(),
        rmsDb: this.rollingRms,
        truePeakDb: this.telemetryMeter.getTruePeakDb(),
        shortTermLufs: this.telemetryMeter.getShortTermLufs(),
      });
    }
  }
}
