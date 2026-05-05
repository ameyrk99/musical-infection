const uploadArea = document.getElementById("upload-area");
const fileInput = document.getElementById("file-input");
const fileNameEl = document.getElementById("file-name");
const bpmInput = document.getElementById("bpm-input");
const hintEl = document.getElementById("hint");
const resetBtn = document.getElementById("reset-btn");

let audioURL = null;
let sourceMode = "upload";

function idleHint() {
  hintEl.classList.remove("text-danger");
  if (sourceMode === "mic" || sourceMode === "system") {
    hintEl.textContent = "click the canvas to start";
  } else {
    hintEl.textContent = audioURL
      ? "click the canvas to start"
      : "select a file, then click the canvas to start";
  }
}

document.querySelectorAll('input[name="source"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    sourceMode = radio.value;
    uploadArea.style.display = sourceMode === "upload" ? "" : "none";
    idleHint();
    resetSketch();
  });
});

uploadArea.addEventListener("click", () => fileInput.click());
uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("drag-over");
});
uploadArea.addEventListener("dragleave", () =>
  uploadArea.classList.remove("drag-over"),
);
uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

function setFile(file) {
  if (audioURL) URL.revokeObjectURL(audioURL);
  audioURL = URL.createObjectURL(file);
  fileNameEl.textContent = file.name;
  hintEl.textContent = "click the canvas to start";
  resetSketch();
}

resetBtn.addEventListener("click", () => {
  resetSketch();
  idleHint();
});

const CELL = 10,
  GAP = 2,
  STEP = CELL + GAP;
const SILENCE_UPLOAD = 2,
  SILENCE_MIC = 8;

const COLORS = [
  ["#a70000", "#ff0000", "#ff5252", "#ff7b7b"],
  ["#00059f", "#0229bf", "#2c2cff", "#4e91fd"],
  ["#006203", "#0f9200", "#30cb00", "#4ae54a"],
  ["#a98600", "#dab600", "#e9d700", "#f8ed62"],
  ["#660066", "#800080", "#be29ec", "#d896ff"],
];
const BANDS = ["bass", "lowMid", "mid", "highMid", "treble"];

let cols,
  rows,
  grid,
  lastBeat = 0,
  fft,
  sound,
  mic,
  systemStream = null,
  started = false;

function resetSketch() {
  if (sound) {
    sound.stop();
    sound = null;
  }
  if (mic) {
    mic.stop();
    mic = null;
  }
  if (systemStream) {
    systemStream.getTracks().forEach((t) => t.stop());
    systemStream = null;
  }
  started = false;
  resetBtn.disabled = true;
  if (grid) grid = Array(cols * rows).fill(null);
}

new p5(function (p) {
  p.setup = function () {
    const cnv = p.createCanvas(525, 525);
    cnv.parent("canvas-container");
    cols = p.floor(p.width / STEP);
    rows = p.floor(p.height / STEP);
    grid = Array(cols * rows).fill(null);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(14);
    p.textFont("monospace");
  };

  p.mousePressed = async function () {
    if (started) return;

    if (sourceMode === "upload" && !audioURL) {
      uploadArea.classList.add("border-warning");
      setTimeout(() => uploadArea.classList.remove("border-warning"), 400);
      return;
    }

    p.userStartAudio();
    grid = Array(cols * rows).fill(null);
    hintEl.textContent = "playing…";
    resetBtn.disabled = false;

    if (sourceMode === "mic") {
      mic = new p5.AudioIn();
      mic.start();
      fft = new p5.FFT(0.4, 512);
      fft.setInput(mic);
      lastBeat = p.millis();
      started = true;
    } else if (sourceMode === "system") {
      try {
        systemStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: false,
        });
        const audioCtx = p.getAudioContext();
        const source = audioCtx.createMediaStreamSource(systemStream);
        fft = new p5.FFT(0.2, 1024);
        source.connect(fft.analyser);
        lastBeat = p.millis();
        started = true;
      } catch {
        hintEl.textContent = "capture cancelled or not supported on this browser/OS";
        hintEl.classList.add("text-danger");
        resetBtn.disabled = true;
      }
    } else {
      sound = p.loadSound(audioURL, () => {
        sound.loop();
        fft = new p5.FFT(0.2, 1024);
        lastBeat = p.millis();
        started = true;
      });
    }
  };

  p.draw = function () {
    p.background(255);

    if (!started) {
      p.fill(150);
      p.text(
        sourceMode !== "upload" || audioURL ? "[ start ]" : "[ upload a file ]",
        p.width / 2,
        p.height / 2,
      );
      return;
    }

    for (let i = 0; i < grid.length; i++) {
      if (!grid[i]) continue;
      p.fill(grid[i]);
      p.noStroke();
      p.rect((i % cols) * STEP, p.floor(i / cols) * STEP, CELL, CELL);
    }

    const beatMs = Math.round(60000 / Number(bpmInput.value) / 4);
    const silence = sourceMode === "mic" ? SILENCE_MIC : SILENCE_UPLOAD;

    if (p.millis() - lastBeat > beatMs) {
      lastBeat = p.millis();
      fft.analyze();
      const energies = BANDS.map((b) => fft.getEnergy(b));
      for (let ci = 0; ci < BANDS.length; ci++) {
        if (energies[ci] > silence) spread(p, ci, energies[ci], silence);
      }
    }
  };

  function spread(p, colorIdx, energy, silence) {
    const hues = COLORS[colorIdx];
    const hasColor = grid.some((c) => c && hues.includes(c));

    if (!hasColor) {
      grid[
        p.floor(p.random(1, rows - 1)) * cols + p.floor(p.random(1, cols - 1))
      ] = p.random(hues);
      return;
    }

    const frontier = [];
    for (let i = 0; i < grid.length; i++) {
      if (!grid[i] || !hues.includes(grid[i])) continue;
      const x = i % cols,
        y = p.floor(i / cols);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (!hues.includes(grid[ni])) frontier.push(ni);
      }
    }

    const claim = p.floor(p.map(energy, silence, 255, 1, 20));
    const picked = p.shuffle(frontier);
    for (let k = 0; k < p.min(claim, picked.length); k++) {
      grid[picked[k]] = p.random(hues);
    }
  }
});
