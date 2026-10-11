import React from 'react';
import { MasteringSettings } from '../services/offlineDb';

interface Props {
  settings: MasteringSettings;
  onChange: (next: MasteringSettings) => void;
}

const eqPresets: Record<string, MasteringSettings['eq']> = {
  flat: { low: 0, lowMid: 0, mid: 0, highMid: 0, high: 0 },
  vocal: { low: -1, lowMid: -1, mid: 1.5, highMid: 2, high: 1.5 },
  bass: { low: 3, lowMid: 1.5, mid: 0, highMid: -0.5, high: -1 },
  bright: { low: -1, lowMid: 0, mid: 0.5, highMid: 2, high: 3 },
  warm: { low: 1.5, lowMid: 1, mid: -0.5, highMid: -1, high: -0.5 },
  aifix: { low: 0, lowMid: -1.5, mid: -0.5, highMid: -2, high: 1.5 },
};

const outputPresets = {
  streaming: { sampleRate: 48000, bitDepth: 24 as const },
  cd: { sampleRate: 44100, bitDepth: 16 as const },
};

const boolFields: Array<[keyof MasteringSettings, string]> = [
  ['glueCompression', 'Glue Compression'],
  ['deharsh', 'De-harsh'],
  ['cleanLowEnd', 'Clean Low End'],
  ['autoLevel', 'Auto Level'],
  ['addPunch', 'Add Punch'],
  ['centerBass', 'Mono Bass'],
  ['cutMud', 'Cut Mud'],
  ['addAir', 'Add Air'],
  ['tapeWarmth', 'Tape Warmth'],
  ['normalizeLoudness', 'Normalize Loudness'],
  ['truePeakLimit', 'True Peak Limit'],
];

const eqFields: Array<[keyof MasteringSettings['eq'], string]> = [
  ['low', '100Hz'],
  ['lowMid', '400Hz'],
  ['mid', '1kHz'],
  ['highMid', '4kHz'],
  ['high', '12kHz'],
];

const WebAudioMasterNativeControls: React.FC<Props> = ({ settings, onChange }) => {
  const setBool = (key: keyof MasteringSettings, value: boolean) => onChange({ ...settings, [key]: value });
  const setNum = (key: keyof MasteringSettings, value: number) => onChange({ ...settings, [key]: value });
  const setEq = (key: keyof MasteringSettings['eq'], value: number) =>
    onChange({ ...settings, eq: { ...settings.eq, [key]: value } });

  const activeOutputPreset = Object.entries(outputPresets).find(
    ([, preset]) => preset.sampleRate === settings.sampleRate && preset.bitDepth === settings.bitDepth
  )?.[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-white">Quick Fix / Polish</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {boolFields.slice(0, 9).map(([key, label]) => (
              <label key={String(key)} className="flex items-center gap-2 text-sm text-slate-300 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
                <input
                  type="checkbox"
                  checked={Boolean(settings[key])}
                  onChange={(e) => setBool(key, e.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-white">Stereo / Loudness</h4>
          <label className="block text-sm text-slate-300">
            <div className="flex justify-between mb-1"><span>Input Gain</span><span>{settings.inputGain.toFixed(1)} dB</span></div>
            <input
              type="range"
              min={-12}
              max={12}
              step={0.5}
              value={settings.inputGain}
              onChange={(e) => setNum('inputGain', Number(e.target.value))}
              className="w-full"
            />
          </label>
          <label className="block text-sm text-slate-300">
            <div className="flex justify-between mb-1"><span>Stereo Width</span><span>{settings.stereoWidth}%</span></div>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={settings.stereoWidth}
              onChange={(e) => setNum('stereoWidth', Number(e.target.value))}
              className="w-full"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-slate-300">
              <div className="mb-1">Target LUFS</div>
              <input type="number" min={-16} max={-6} step={0.5} value={settings.targetLufs} onChange={(e) => setNum('targetLufs', Number(e.target.value))} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white" />
            </label>
            <label className="text-sm text-slate-300">
              <div className="mb-1">Ceiling (dBTP)</div>
              <input type="number" min={-6} max={0} step={0.5} value={settings.ceiling} onChange={(e) => setNum('ceiling', Number(e.target.value))} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {boolFields.slice(9).map(([key, label]) => (
              <label key={String(key)} className="flex items-center gap-2 text-sm text-slate-300 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
                <input
                  type="checkbox"
                  checked={Boolean(settings[key])}
                  onChange={(e) => setBool(key, e.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-white">Output</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(outputPresets).map(([name, preset]) => (
              <button
                key={name}
                type="button"
                onClick={() => onChange({ ...settings, sampleRate: preset.sampleRate, bitDepth: preset.bitDepth })}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${activeOutputPreset === name ? 'border-emerald-500 text-emerald-300 bg-emerald-500/10' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-slate-300">
              <div className="mb-1">Sample Rate</div>
              <select value={settings.sampleRate} onChange={(e) => setNum('sampleRate', Number(e.target.value))} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white">
                <option value={44100}>44.1 kHz</option>
                <option value={48000}>48 kHz</option>
              </select>
            </label>
            <label className="text-sm text-slate-300">
              <div className="mb-1">Bit Depth</div>
              <select value={settings.bitDepth} onChange={(e) => setNum('bitDepth', Number(e.target.value))} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white">
                <option value={16}>16-bit</option>
                <option value={24}>24-bit</option>
              </select>
            </label>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h4 className="text-sm font-semibold text-white">EQ</h4>
          <div className="flex flex-wrap gap-2">
            {Object.keys(eqPresets).map((presetName) => (
              <button
                key={presetName}
                type="button"
                onClick={() => onChange({ ...settings, eq: { ...eqPresets[presetName] } })}
                className="px-2.5 py-1 text-xs rounded-lg border border-slate-700 text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300"
              >
                {presetName}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {eqFields.map(([key, label]) => (
            <label key={String(key)} className="text-sm text-slate-300">
              <div className="flex justify-between mb-1">
                <span>{label}</span>
                <span className="text-slate-400">{settings.eq[key].toFixed(1)} dB</span>
              </div>
              <input
                type="range"
                min={-12}
                max={12}
                step={0.5}
                value={settings.eq[key]}
                onChange={(e) => setEq(key, Number(e.target.value))}
                className="w-full"
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
};

export default WebAudioMasterNativeControls;
