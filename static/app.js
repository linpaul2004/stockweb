const { defaultStock, refreshSeconds } = window.STOCK_CONFIG;

const stockInput = document.getElementById("stock-code");
const searchBtn = document.getElementById("search-btn");
const statusText = document.getElementById("status-text");
const countdownEl = document.getElementById("countdown");
const countdownWrap = document.getElementById("countdown-wrap");
const stockPanel = document.getElementById("stock-panel");
const errorPanel = document.getElementById("error-panel");
const chartMessage = document.getElementById("chart-message");
const chartPrevClose = document.getElementById("chart-prev-close");
const priceLabelEl = document.getElementById("price-label");
const invertColorsToggle = document.getElementById("invert-colors-toggle");

let countdown = refreshSeconds;
let countdownTimer = null;
let chartTimer = null;
let currentCode = defaultStock;
let isFetching = false;
let priceChart = null;
let lastLatestPrice = null;
let lastTradeVolume = null;
let lastPrevClose = null;
let invertColors = localStorage.getItem("invertColors") !== "false";

const CHART_REFRESH_SECONDS = 30;

function getTaipeiNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function isTradingHours() {
  const taipei = getTaipeiNow();
  const day = taipei.getDay();
  if (day === 0 || day === 6) {
    return false;
  }

  const minutes = taipei.getHours() * 60 + taipei.getMinutes();
  const openMinutes = 9 * 60;
  const closeMinutes = 13 * 60 + 30;
  return minutes >= openMinutes && minutes < closeMinutes;
}

function stopAllRefresh() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (chartTimer) {
    clearInterval(chartTimer);
    chartTimer = null;
  }
}

function setMarketClosedStatus(code) {
  statusText.textContent = `已收盤 · ${code}`;
  countdownWrap.classList.add("hidden");
  updatePriceLabel();
}

function setMarketOpenStatus(code) {
  statusText.textContent = `已載入 ${code} 即時資料`;
  countdownWrap.classList.remove("hidden");
  updatePriceLabel();
}

function updatePriceLabel() {
  priceLabelEl.textContent = isTradingHours() ? "最新成交價" : "收盤價";
}

function applyColorMode() {
  document.body.classList.toggle("color-tw", invertColors);
  invertColorsToggle.checked = invertColors;
}

function refreshPriceDisplay() {
  const priceEl = document.getElementById("display-price");
  const changeEl = document.getElementById("display-change");

  if (!hasValue(lastLatestPrice)) {
    return;
  }

  priceEl.textContent = formatNumber(lastLatestPrice);

  if (hasValue(lastPrevClose)) {
    const changeClass = getChangeClass(lastLatestPrice, lastPrevClose);
    priceEl.className = `price-value ${changeClass}`;

    const diff = Number(lastLatestPrice) - Number(lastPrevClose);
    const pct = (diff / Number(lastPrevClose)) * 100;
    const sign = diff > 0 ? "+" : "";
    changeEl.textContent = `${sign}${diff.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
    changeEl.className = `price-change ${changeClass}`;
  }
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "" && value !== "-";
}

function resetStockDisplayCache() {
  lastLatestPrice = null;
  lastTradeVolume = null;
  lastPrevClose = null;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "" || value === "-") {
    return "—";
  }
  const number = Number(value);
  if (Number.isNaN(number)) {
    return value;
  }
  return number.toLocaleString("zh-TW");
}

function getChangeClass(latest, reference) {
  const latestNum = Number(latest);
  const refNum = Number(reference);
  if (Number.isNaN(latestNum) || Number.isNaN(refNum)) {
    return "flat";
  }
  if (latestNum > refNum) {
    return "up";
  }
  if (latestNum < refNum) {
    return "down";
  }
  return "flat";
}

function setComparedStatValue(elementId, value) {
  const el = document.getElementById(elementId);
  el.textContent = formatNumber(value);
  const changeClass =
    hasValue(value) && hasValue(lastPrevClose)
      ? getChangeClass(value, lastPrevClose)
      : "flat";
  el.className = `stat-value ${changeClass}`;
}

function renderOrderBookRows(containerId, prices, volumes, priceClass) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const maxRows = Math.max(prices?.length || 0, volumes?.length || 0, 5);
  for (let i = 0; i < maxRows; i += 1) {
    const row = document.createElement("tr");
    const price = prices?.[i] ?? "—";
    const volume = volumes?.[i] ?? "—";

    row.innerHTML = `
      <td class="${priceClass}">${formatNumber(price)}</td>
      <td>${formatNumber(volume)}</td>
    `;
    container.appendChild(row);
  }
}

function renderStock(data) {
  const info = data.info || {};
  const realtime = data.realtime || {};
  const latest = realtime.latest_trade_price;
  const prevClose = data.prev_close;

  updatePriceLabel();

  if (hasValue(prevClose)) {
    lastPrevClose = prevClose;
  }
  if (hasValue(latest)) {
    lastLatestPrice = latest;
  }
  if (hasValue(realtime.trade_volume)) {
    lastTradeVolume = realtime.trade_volume;
  }

  document.getElementById("display-code").textContent = info.code || currentCode;
  document.getElementById("display-name").textContent = info.name || "—";
  document.getElementById("display-fullname").textContent = info.fullname || "";
  document.getElementById("display-time").textContent = info.time ? `更新時間：${info.time}` : "";

  const priceEl = document.getElementById("display-price");
  const changeEl = document.getElementById("display-change");

  if (hasValue(lastLatestPrice)) {
    refreshPriceDisplay();
  } else {
    priceEl.textContent = "";
    changeEl.textContent = "";
    changeEl.className = "price-change flat";
  }

  document.getElementById("display-open").textContent = formatNumber(realtime.open);
  setComparedStatValue("display-high", realtime.high);
  setComparedStatValue("display-low", realtime.low);

  if (hasValue(lastTradeVolume)) {
    document.getElementById("display-trade-volume").textContent = formatNumber(lastTradeVolume);
  }

  document.getElementById("display-accum-volume").textContent = formatNumber(realtime.accumulate_trade_volume);

  renderOrderBookRows(
    "bid-rows",
    realtime.best_bid_price,
    realtime.best_bid_volume,
    "up"
  );
  renderOrderBookRows(
    "ask-rows",
    realtime.best_ask_price,
    realtime.best_ask_volume,
    "down"
  );

  stockPanel.classList.remove("hidden");
  errorPanel.classList.add("hidden");
}

function initColorToggle() {
  applyColorMode();
  updatePriceLabel();
  invertColorsToggle.addEventListener("change", () => {
    invertColors = invertColorsToggle.checked;
    localStorage.setItem("invertColors", String(invertColors));
    applyColorMode();
  });
}

function setChartMessage(message) {
  if (!message) {
    chartMessage.textContent = "";
    chartMessage.classList.add("hidden");
    return;
  }

  chartMessage.textContent = message;
  chartMessage.classList.remove("hidden");
}

function renderChart(data) {
  const points = data.points || [];
  const prevClose = data.prev_close;

  chartPrevClose.textContent =
    prevClose !== null && prevClose !== undefined
      ? `昨收 ${Number(prevClose).toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
      : "";

  if (!points.length) {
    if (priceChart) {
      priceChart.destroy();
      priceChart = null;
    }
    setChartMessage(data.message || "尚無當日走勢資料");
    return;
  }

  setChartMessage("");

  const labels = points.map((point) => point.time);
  const prices = points.map((point) => point.price);
  const canvas = document.getElementById("price-chart");
  const ctx = canvas.getContext("2d");

  if (priceChart) {
    priceChart.destroy();
  }

  const datasets = [
    {
      label: "成交價",
      data: prices,
      borderColor: "#4f8cff",
      backgroundColor: "rgba(79, 140, 255, 0.12)",
      fill: true,
      tension: 0.2,
      pointRadius: 0,
      borderWidth: 2,
    },
  ];

  if (prevClose !== null && prevClose !== undefined) {
    datasets.push({
      label: "昨收",
      data: labels.map(() => prevClose),
      borderColor: "#94a3b8",
      borderDash: [6, 4],
      pointRadius: 0,
      borderWidth: 1.5,
      fill: false,
    });
  }

  priceChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          labels: {
            color: "#e8edf7",
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "時間",
            color: "#8b9bb8",
          },
          ticks: {
            color: "#8b9bb8",
            maxTicksLimit: 8,
          },
          grid: {
            color: "rgba(36, 48, 73, 0.6)",
          },
        },
        y: {
          min: data.y_min,
          max: data.y_max,
          title: {
            display: true,
            text: "價格",
            color: "#8b9bb8",
          },
          ticks: {
            color: "#8b9bb8",
          },
          grid: {
            color: "rgba(36, 48, 73, 0.6)",
          },
        },
      },
    },
  });
}

async function fetchChart(code) {
  const normalizedCode = code.trim();
  if (!normalizedCode) {
    return;
  }

  try {
    const response = await fetch(`/api/chart?code=${encodeURIComponent(normalizedCode)}`);
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || "無法取得走勢資料");
    }

    renderChart(data);
  } catch (error) {
    if (priceChart) {
      priceChart.destroy();
      priceChart = null;
    }
    chartPrevClose.textContent = "";
    setChartMessage(error.message || "走勢圖載入失敗");
  }
}

function startChartRefresh() {
  if (!isTradingHours()) {
    return;
  }

  if (chartTimer) {
    clearInterval(chartTimer);
  }

  chartTimer = setInterval(() => {
    if (!isTradingHours()) {
      stopAllRefresh();
      setMarketClosedStatus(currentCode);
      return;
    }
    fetchChart(currentCode);
  }, CHART_REFRESH_SECONDS * 1000);
}

function showError(message) {
  errorPanel.textContent = message;
  errorPanel.classList.remove("hidden");
  stockPanel.classList.add("hidden");
}

function resetCountdown() {
  countdown = refreshSeconds;
  countdownEl.textContent = String(countdown);
}

function startCountdown() {
  if (!isTradingHours()) {
    return;
  }

  if (countdownTimer) {
    clearInterval(countdownTimer);
  }

  resetCountdown();
  countdownTimer = setInterval(() => {
    if (!isTradingHours()) {
      stopAllRefresh();
      setMarketClosedStatus(currentCode);
      return;
    }

    countdown -= 1;
    countdownEl.textContent = String(Math.max(countdown, 0));

    if (countdown <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      fetchStock(currentCode, false);
    }
  }, 1000);
}

async function fetchStock(code, manual = true) {
  const normalizedCode = code.trim();
  if (!normalizedCode) {
    showError("請輸入股票代號");
    return;
  }

  if (!manual && !isTradingHours()) {
    return;
  }

  if (isFetching) {
    return;
  }

  const stockChanged = normalizedCode !== currentCode;
  isFetching = true;
  currentCode = normalizedCode;

  if (stockChanged) {
    resetStockDisplayCache();
  }

  statusText.textContent = manual ? `正在查詢 ${normalizedCode}...` : `正在更新 ${normalizedCode}...`;

  try {
    const response = await fetch(`/api/stock?code=${encodeURIComponent(normalizedCode)}`);
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || "無法取得股票資料");
    }

    renderStock(data);

    if (isTradingHours()) {
      setMarketOpenStatus(normalizedCode);
      resetCountdown();
      startCountdown();

      if (manual || stockChanged) {
        fetchChart(normalizedCode);
        startChartRefresh();
      }
    } else {
      stopAllRefresh();
      setMarketClosedStatus(normalizedCode);

      if (manual || stockChanged) {
        fetchChart(normalizedCode);
      }
    }
  } catch (error) {
    showError(error.message || "查詢失敗，請稍後再試");

    if (isTradingHours()) {
      statusText.textContent = "查詢失敗";
      resetCountdown();
      startCountdown();
    } else {
      stopAllRefresh();
      setMarketClosedStatus(normalizedCode);
    }
  } finally {
    isFetching = false;
  }
}

function handleSearch() {
  fetchStock(stockInput.value, true);
}

searchBtn.addEventListener("click", handleSearch);
stockInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    handleSearch();
  }
});

fetchStock(defaultStock, true);
initColorToggle();
