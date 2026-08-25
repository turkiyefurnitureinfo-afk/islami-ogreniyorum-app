// One-off generator: creates android/app/src/main/res/raw/notification_high.wav
// A bright, loud attention chime (double-beeps alternating A5/D6) ~6 seconds,
// 22.05 kHz mono 16-bit PCM (~260 KB) -- suitable as an Android notification
// channel sound that clearly stands out from default system sounds.
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 22050;
const DURATION_S = 6;
const N = SAMPLE_RATE * DURATION_S;
const data = Buffer.alloc(44 + N * 2);

// --- WAV header ---
data.write('RIFF', 0);
data.writeUInt32LE(36 + N * 2, 4);
data.write('WAVE', 8);
data.write('fmt ', 12);
data.writeUInt32LE(16, 16);          // fmt chunk size
data.writeUInt16LE(1, 20);           // PCM
data.writeUInt16LE(1, 22);           // mono
data.writeUInt32LE(SAMPLE_RATE, 24);
data.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
data.writeUInt16LE(2, 32);           // block align
data.writeUInt16LE(16, 34);          // bits/sample
data.write('data', 36);
data.writeUInt32LE(N * 2, 40);

// --- tone pattern: cycles of 900ms -> beep 880Hz(180ms), gap, beep 1245Hz(180ms), gap ---
function amp(t) {
  const cyc = t % 0.9;
  let env = 0;
  if (cyc < 0.18) env = Math.min(1, (0.18 - cyc) * 40);        // fast attack/decay
  else if (cyc >= 0.3 && cyc < 0.48) env = Math.min(1, (0.48 - cyc) * 40);
  if (env <= 0) return 0;
  const freq = cyc < 0.24 ? 880 : 1245;
  // sine + 2nd harmonic for a sharper "alarm" timbre
  const s =
    Math.sin(2 * Math.PI * freq * t) * 0.75 +
    Math.sin(2 * Math.PI * freq * 2 * t) * 0.25;
  return s * env * 0.88;
}

for (let i = 0; i < N; i++) {
  const v = Math.max(-1, Math.min(1, amp(i / SAMPLE_RATE)));
  data.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}

const outDir = path.join(__dirname, 'android', 'app', 'src', 'main', 'res', 'raw');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'notification_high.wav');
fs.writeFileSync(outPath, data);
console.log('Wrote', outPath, (fs.statSync(outPath).size / 1024).toFixed(1) + ' KB');