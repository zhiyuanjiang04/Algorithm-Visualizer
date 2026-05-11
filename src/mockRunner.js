function deepCopyArray(arr) {
  return Array.isArray(arr) ? arr.slice() : [];
}

function speedToMs(speed) {
  if (speed === 'slow') return 1200;
  if (speed === 'fast') return 280;
  return 650;
}

function makeStepBuilder(algorithm) {
  let stepId = 0;
  return (arr, description, extra = {}) => ({
    id: ++stepId,
    algorithm,
    description,
    array: deepCopyArray(arr),
    ...extra,
  });
}

function buildHeapSteps(inputArr) {
  const arr = deepCopyArray(inputArr);
  const stepOf = makeStepBuilder('heap_build');
  const steps = [stepOf(arr, '初始数组，准备构建大顶堆。')];

  function pushStep(description, extra) {
    steps.push(stepOf(arr, description, extra));
  }

  function siftDown(start, end) {
    let root = start;

    while (root * 2 + 1 <= end) {
      const left = root * 2 + 1;
      const right = left + 1;
      let candidate = left;

      if (right <= end) {
        pushStep('比较左右子节点，选择更大的子节点参与上滤。', {
          active: root,
          compare: [left, right],
        });
        if (arr[right] > arr[left]) candidate = right;
      }

      pushStep(`比较父节点与候选子节点：a[${root}] 与 a[${candidate}]。`, {
        active: root,
        compare: [candidate],
      });

      if (arr[root] < arr[candidate]) {
        const i = root;
        const j = candidate;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        pushStep(`交换 a[${i}] 与 a[${j}]，继续向下调整。`, {
          active: i,
          compare: [j],
          swap: [i, j],
        });
        root = candidate;
      } else {
        pushStep(`节点 a[${root}] 已满足堆性质，本轮筛选结束。`, {
          active: root,
          doneRange: [start, end],
        });
        return;
      }
    }
  }

  for (let i = Math.floor((arr.length - 2) / 2); i >= 0; i--) {
    pushStep(`从最后一个非叶子节点开始筛选：i=${i}。`, { active: i });
    siftDown(i, arr.length - 1);
  }

  pushStep('堆创建完成，当前数组已满足大顶堆结构。', {
    doneRange: [0, arr.length - 1],
  });

  return steps;
}

function buildQuickSortSteps(inputArr) {
  const arr = deepCopyArray(inputArr);
  const stepOf = makeStepBuilder('quick_sort');
  const steps = [stepOf(arr, '初始数组，准备执行快速排序。')];

  function pushStep(description, extra) {
    steps.push(stepOf(arr, description, extra));
  }

  function partition(l, r) {
    const pivot = arr[r];
    let i = l - 1;
    pushStep(`选择区间 [${l}, ${r}] 的末尾元素 ${pivot} 作为基准。`, {
      active: r,
      doneRange: [l, r],
    });

    for (let j = l; j < r; j++) {
      pushStep(`比较 a[${j}]=${arr[j]} 与基准 ${pivot}。`, {
        active: r,
        compare: [j],
        doneRange: [l, r],
      });

      if (arr[j] <= pivot) {
        i += 1;
        if (i !== j) {
          [arr[i], arr[j]] = [arr[j], arr[i]];
          pushStep(`a[${j}] <= 基准，交换 a[${i}] 与 a[${j}]。`, {
            active: r,
            compare: [i, j],
            swap: [i, j],
            doneRange: [l, r],
          });
        } else {
          pushStep(`a[${j}] <= 基准，元素位置无需调整。`, {
            active: r,
            compare: [j],
            doneRange: [l, r],
          });
        }
      }
    }

    const p = i + 1;
    if (p !== r) {
      [arr[p], arr[r]] = [arr[r], arr[p]];
      pushStep(`将基准放到最终位置 p=${p}。`, {
        active: p,
        compare: [r],
        swap: [p, r],
        doneRange: [l, r],
      });
    } else {
      pushStep(`基准已在正确位置 p=${p}。`, {
        active: p,
        doneRange: [l, r],
      });
    }
    return p;
  }

  function quickSort(l, r) {
    if (l > r) return;
    if (l === r) {
      pushStep(`区间 [${l}, ${r}] 只有一个元素，天然有序。`, {
        active: l,
        doneRange: [l, r],
      });
      return;
    }

    const p = partition(l, r);
    quickSort(l, p - 1);
    quickSort(p + 1, r);
  }

  quickSort(0, arr.length - 1);

  pushStep('快速排序完成，数组整体有序。', {
    doneRange: [0, arr.length - 1],
  });

  return steps;
}

export class LocalDemoRunner {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.steps = [];
    this.index = 0;
    this.timer = null;
    this.running = false;
    this.paused = false;
  }

  prepare({ algorithm, input }) {
    this.reset(false);
    this.steps = algorithm === 'quick_sort' ? buildQuickSortSteps(input) : buildHeapSteps(input);
  }

  start(speed = 'normal') {
    if (!this.steps.length) return;
    this.running = true;
    this.paused = false;
    this.play(speed);
  }

  play(speed = 'normal') {
    this.stopTimer();
    const delay = speedToMs(speed);
    this.timer = window.setInterval(() => {
      if (!this.running || this.paused) return;
      const hasMore = this.next();
      if (!hasMore) this.finish('演示完成（本地模式）');
    }, delay);
  }

  pause() {
    this.paused = true;
  }

  resume(speed = 'normal') {
    if (!this.running) return;
    this.paused = false;
    this.play(speed);
  }

  next() {
    if (!this.running) return false;
    if (this.index >= this.steps.length) return false;

    const step = this.steps[this.index++];
    this.hooks.onStep?.(step);
    return this.index < this.steps.length;
  }

  finish(message) {
    this.running = false;
    this.paused = false;
    this.stopTimer();
    this.hooks.onDone?.(message);
  }

  reset(emit = true) {
    this.running = false;
    this.paused = false;
    this.stopTimer();
    this.steps = [];
    this.index = 0;
    if (emit) this.hooks.onReset?.();
  }

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
