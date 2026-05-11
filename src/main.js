import { SocketClient } from './socket.js';
import { LocalDemoRunner } from './mockRunner.js';
import { HeapVisualizer, QuickSortVisualizer } from './visualizer.js';

const API_BASE = 'http://47.93.13.239:8080';

const state = {
  sessionId: crypto.randomUUID(),
  get wsUrl() { return `ws://47.93.13.239:8080/ws`; },
  algorithm: 'heap_build',
  runMode: 'mock',
  connected: false,
  started: false,
  paused: false,
  lastStep: null,
};

const el = {
  algorithmSelect: document.querySelector('#algorithmSelect'),
  runModeRadios: document.querySelectorAll('input[name="runMode"]'),
  numberInput: document.querySelector('#numberInput'),
  speedSelect: document.querySelector('#speedSelect'),
  submitBtn: document.querySelector('#submitBtn'),
  pauseBtn: document.querySelector('#pauseBtn'),
  resumeBtn: document.querySelector('#resumeBtn'),
  stepBtn: document.querySelector('#stepBtn'),
  resetBtn: document.querySelector('#resetBtn'),
  wsStatus: document.querySelector('#wsStatus'),
  playStatus: document.querySelector('#playStatus'),
  stepMeta: document.querySelector('#stepMeta'),
  stepDescription: document.querySelector('#stepDescription'),
  toast: document.querySelector('#toast'),
  vizCanvas: document.querySelector('#vizCanvas'),
};

const heapViz = new HeapVisualizer(el.vizCanvas);
const quickViz = new QuickSortVisualizer(el.vizCanvas);

function currentViz() {
  return state.algorithm === 'quick_sort' ? quickViz : heapViz;
}

function setWsStatus(text, ok = false) {
  el.wsStatus.textContent = text;
  el.wsStatus.style.color = ok ? '#047857' : '#b91c1c';
}

function setPlayStatus(text, color = '#374151') {
  el.playStatus.textContent = text;
  el.playStatus.style.color = color;
}

function showToast(text, isError = false) {
  el.toast.textContent = text;
  el.toast.classList.remove('hidden', 'error');
  if (isError) el.toast.classList.add('error');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => el.toast.classList.add('hidden'), 2600);
}

function setButtons() {
  el.pauseBtn.disabled = !state.started || state.paused;
  el.resumeBtn.disabled = !state.started || !state.paused;
  el.stepBtn.disabled = !state.started;
}

function parseInput(raw) {
  const text = raw.trim();
  if (!text) return { ok: false, msg: '请输入整数数据' };

  const arr = text
    .split(/[，,\s]+/)
    .filter(Boolean)
    .map((x) => Number(x));

  if (arr.some((n) => !Number.isInteger(n))) {
    return { ok: false, msg: '输入必须全部是整数' };
  }

  if (state.algorithm === 'heap_build' && arr.length !== 9) {
    return { ok: false, msg: '堆创建实验建议输入且仅输入 9 个整数' };
  }

  if (arr.length < 2) {
    return { ok: false, msg: '请至少输入 2 个整数' };
  }

  return { ok: true, arr };
}

function renderStep(step) {
  state.lastStep = step;

  const id = step?.id ?? '-';
  const algo = step?.algorithm ?? state.algorithm;
  const desc = step?.description ?? '（未提供步骤说明）';

  el.stepMeta.innerHTML = `<span>步骤：${id}</span><span>算法：${algo}</span>`;
  el.stepDescription.textContent = desc;

  currentViz().render(step);
}

function resetPage(emitReset = true) {
  state.started = false;
  state.paused = false;
  state.lastStep = null;
  setButtons();

  el.stepMeta.innerHTML = '<span>步骤：-</span><span>算法：-</span>';
  el.stepDescription.textContent = '等待步骤数据...';
  currentViz().clear();
  setPlayStatus('待开始');

  if (emitReset) {
    if (state.runMode === 'mock') {
      localRunner.reset(false);
    } else {
      socket.send({ type: 'reset', sessionId: state.sessionId });
    }
  }
}

function applyRunMode(mode) {
  state.runMode = mode;
  if (mode === 'mock') {
    setWsStatus('本地模式（未连接）', true);
    socket.close();
  } else {
    setWsStatus('连接中...', false);
    socket.connect();
  }
  resetPage(false);
}

const localRunner = new LocalDemoRunner({
  onStep(step) {
    renderStep(step);
  },
  onDone(message) {
    state.started = false;
    state.paused = false;
    setButtons();
    setPlayStatus('已完成', '#15803d');
    showToast(message || '演示完成');
  },
});

async function submitAndStart() {
  const parsed = parseInput(el.numberInput.value);
  if (!parsed.ok) {
    showToast(parsed.msg, true);
    return;
  }

  if (state.runMode === 'mock') {
    localRunner.prepare({
      sessionId: state.sessionId,
      algorithm: state.algorithm,
      input: parsed.arr,
    });
    state.started = true;
    state.paused = false;
    setButtons();
    setPlayStatus('演示中（本地）', '#0369a1');
    localRunner.start(el.speedSelect.value);
    showToast('本地模式已开始演示');
    return;
  }

  const payload = {
    sessionId: state.sessionId,
    algorithm: state.algorithm,
    input: parsed.arr,
  };

  try {
    const resp = await fetch(`${API_BASE}/api/visualize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = await resp.json();
    if (!resp.ok || json.ok === false) {
      throw new Error(json.message || '提交失败');
    }

    const sent = socket.send({
      type: 'start',
      sessionId: state.sessionId,
      algorithm: state.algorithm,
      speed: el.speedSelect.value,
    });

    if (!sent) {
      throw new Error('WebSocket 未连接，无法开始演示');
    }

    state.started = true;
    state.paused = false;
    setButtons();
    setPlayStatus('演示中', '#0369a1');
    showToast('数据提交成功，已请求后端开始推送步骤');
  } catch (err) {
    showToast(err.message || '提交失败', true);
  }
}

function bindEvents() {
  el.algorithmSelect.addEventListener('change', () => {
    state.algorithm = el.algorithmSelect.value;
    resetPage(false);
    showToast(`已切换算法：${state.algorithm === 'heap_build' ? '堆创建' : '快速排序'}`);
  });

  el.runModeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      applyRunMode(radio.value);
      showToast(radio.value === 'mock' ? '已切换到本地演示模式' : '已切换到联调模式');
    });
  });

  el.submitBtn.addEventListener('click', submitAndStart);

  el.pauseBtn.addEventListener('click', () => {
    if (state.runMode === 'mock') {
      localRunner.pause();
      state.paused = true;
      setButtons();
      setPlayStatus('已暂停', '#b45309');
      return;
    }

    const sent = socket.send({ type: 'pause', sessionId: state.sessionId });
    if (!sent) return showToast('WebSocket 未连接', true);
    state.paused = true;
    setButtons();
    setPlayStatus('已暂停', '#b45309');
  });

  el.resumeBtn.addEventListener('click', () => {
    if (state.runMode === 'mock') {
      localRunner.resume(el.speedSelect.value);
      state.paused = false;
      setButtons();
      setPlayStatus('演示中（本地）', '#0369a1');
      return;
    }

    const sent = socket.send({ type: 'resume', sessionId: state.sessionId });
    if (!sent) return showToast('WebSocket 未连接', true);
    state.paused = false;
    setButtons();
    setPlayStatus('演示中', '#0369a1');
  });

  el.stepBtn.addEventListener('click', () => {
    if (state.runMode === 'mock') {
      const hasMore = localRunner.next();
      if (!hasMore && state.started) {
        localRunner.finish('演示完成（本地模式）');
      }
      return;
    }

    const sent = socket.send({ type: 'step', sessionId: state.sessionId });
    if (!sent) return showToast('WebSocket 未连接', true);
  });

  el.resetBtn.addEventListener('click', () => {
    el.numberInput.value = '';
    resetPage(true);
    showToast('已重置');
  });
}

const socket = new SocketClient(state.wsUrl, {
  onOpen() {
    state.connected = true;
    setWsStatus('已连接', true);
    socket.send({ type: 'hello', sessionId: state.sessionId });
  },
  onClose() {
    state.connected = false;
    if (state.runMode === 'server') {
      setWsStatus('连接断开（自动重连中）', false);
    }
  },
  onReconnect() {
    if (state.runMode === 'server') {
      setWsStatus('重连中...', false);
    }
  },
  onError(msg) {
    if (state.runMode === 'server') {
      showToast(msg, true);
    }
  },
  onMessage(msg) {
    if (state.runMode !== 'server') return;

    switch (msg.type) {
      case 'connected':
        if (msg.sessionId) state.sessionId = msg.sessionId;
        setWsStatus('已连接', true);
        break;
      case 'step':
        renderStep(msg.payload || msg.step || {});
        break;
      case 'done':
        setPlayStatus('已完成', '#15803d');
        state.started = false;
        state.paused = false;
        setButtons();
        showToast(msg.message || '演示完成');
        break;
      case 'error':
        showToast(msg.message || '后端返回错误', true);
        break;
      case 'pong':
      default:
        break;
    }
  },
});

function initDemoData() {
  el.numberInput.value = '7,2,9,1,5,8,3,6,4';
}

function init() {
  bindEvents();
  initDemoData();
  resetPage(false);
  applyRunMode('mock');
}

init();