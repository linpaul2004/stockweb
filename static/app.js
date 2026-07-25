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
const chartLegend = document.getElementById("chart-legend");
const chartLegendTrade = document.getElementById("chart-legend-trade");
const chartLegendUp = document.getElementById("chart-legend-up");
const chartLegendDown = document.getElementById("chart-legend-down");
const chartLegendPrev = document.getElementById("chart-legend-prev");
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
let lastChartData = null;
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

function getThemeColor(cssVar) {
  return getComputedStyle(document.body).getPropertyValue(cssVar).trim();
}

function colorWithAlpha(color, alpha) {
  if (!color) {
    return `rgba(148, 163, 184, ${alpha})`;
  }

  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const full =
      hex.length === 3 ? hex.split("").map((char) => char + char).join("") : hex;
    const red = Number.parseInt(full.slice(0, 2), 16);
    const green = Number.parseInt(full.slice(2, 4), 16);
    const blue = Number.parseInt(full.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  return color;
}

function getChartTrendColors(latestPrice, prevClose) {
  const changeClass =
    hasValue(prevClose) && hasValue(latestPrice)
      ? getChangeClass(latestPrice, prevClose)
      : "flat";
  const cssVar =
    changeClass === "up" ? "--up" : changeClass === "down" ? "--down" : "--flat";
  const borderColor = getThemeColor(cssVar) || "#4f8cff";

  return {
    borderColor,
    backgroundColor: colorWithAlpha(borderColor, 0.12),
  };
}

function buildPriceSegmentStyle(prevClose) {
  return {
    borderColor: (ctx) => {
      const start = ctx.p0?.parsed?.y;
      const end = ctx.p1?.parsed?.y;
      if (start == null || end == null) {
        return undefined;
      }

      const segmentPrice = (start + end) / 2;
      return getChartTrendColors(segmentPrice, prevClose).borderColor;
    },
    backgroundColor: (ctx) => {
      const start = ctx.p0?.parsed?.y;
      const end = ctx.p1?.parsed?.y;
      if (start == null || end == null) {
        return undefined;
      }

      const segmentPrice = (start + end) / 2;
      return getChartTrendColors(segmentPrice, prevClose).backgroundColor;
    },
  };
}

function updateChartLegendColors() {
  const upColor = getThemeColor("--up");
  const downColor = getThemeColor("--down");
  const flatColor = getThemeColor("--flat");

  const legendTrade = document.querySelector(".chart-legend-line-trade");
  const legendUp = document.querySelector(".chart-legend-line-up");
  const legendDown = document.querySelector(".chart-legend-line-down");

  if (legendTrade) {
    legendTrade.style.borderTopColor = flatColor;
  }
  if (legendUp) {
    legendUp.style.borderTopColor = upColor;
  }
  if (legendDown) {
    legendDown.style.borderTopColor = downColor;
  }
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

function buildOrderBookLevels(prices, volumes, side) {
  const levels = [];
  const maxRows = Math.max(prices?.length || 0, volumes?.length || 0);

  for (let i = 0; i < maxRows; i += 1) {
    const price = prices?.[i];
    const volume = volumes?.[i];
    if (!hasValue(price)) {
      continue;
    }

    levels.push({
      side,
      price: Number(price),
      volume,
    });
  }

  return levels;
}

function getOrderBookLayout() {
  let layout = document.getElementById("order-book-layout");
  if (layout) {
    return layout;
  }

  const section = document.querySelector(".order-book");
  if (!section) {
    return null;
  }

  layout = document.createElement("div");
  layout.className = "order-book-layout";
  layout.id = "order-book-layout";
  layout.innerHTML = `
    <span class="order-book-head-side" aria-hidden="true"></span>
    <span class="order-book-head-price">價格</span>
    <span class="order-book-head-volume">量</span>
  `;

  const legacyTable = section.querySelector("table");
  if (legacyTable) {
    legacyTable.replaceWith(layout);
    return layout;
  }

  const legacyBody = section.querySelector("#order-book-rows");
  if (legacyBody) {
    legacyBody.replaceWith(layout);
    return layout;
  }

  section.appendChild(layout);
  return layout;
}

function clearOrderBookData(layout) {
  while (layout.children.length > 3) {
    layout.removeChild(layout.lastChild);
  }
}

function appendOrderBookLevel(layout, level, row) {
  const priceClass =
    hasValue(lastPrevClose) ? getChangeClass(level.price, lastPrevClose) : "flat";

  const price = document.createElement("div");
  price.className = `order-price ${priceClass}`;
  price.style.gridRow = String(row);
  price.style.gridColumn = "2";
  price.textContent = formatNumber(level.price);

  const volume = document.createElement("div");
  volume.className = "order-volume";
  volume.style.gridRow = String(row);
  volume.style.gridColumn = "3";
  volume.textContent = formatNumber(level.volume);

  layout.appendChild(price);
  layout.appendChild(volume);
}

function appendOrderBookMarker(layout, side, row, span) {
  const marker = document.createElement("div");
  const isAsk = side === "ask";
  marker.className = `order-side-marker ${isAsk ? "order-side-marker-ask" : "order-side-marker-bid"}`;
  marker.style.gridRow = `${row} / ${row + span}`;
  marker.style.gridColumn = "1";
  marker.innerHTML = isAsk
    ? `
      <div class="order-side-marker-inner">
        <span class="order-side-arrow" aria-hidden="true">↑</span>
        <span class="order-side-label">賣價</span>
      </div>
    `
    : `
      <div class="order-side-marker-inner">
        <span class="order-side-label">買價</span>
        <span class="order-side-arrow" aria-hidden="true">↓</span>
      </div>
    `;
  layout.appendChild(marker);
}

function renderOrderBook(realtime) {
  const layout = getOrderBookLayout();
  if (!layout) {
    return;
  }

  clearOrderBookData(layout);

  const askLevels = buildOrderBookLevels(
    realtime.best_ask_price,
    realtime.best_ask_volume,
    "ask"
  ).sort((a, b) => b.price - a.price);

  const bidLevels = buildOrderBookLevels(
    realtime.best_bid_price,
    realtime.best_bid_volume,
    "bid"
  ).sort((a, b) => b.price - a.price);

  if (!askLevels.length && !bidLevels.length) {
    const empty = document.createElement("div");
    empty.className = "order-book-empty";
    empty.style.gridRow = "2";
    empty.style.gridColumn = "1 / -1";
    empty.textContent = "—";
    layout.appendChild(empty);
    return;
  }

  let currentRow = 2;

  if (askLevels.length) {
    appendOrderBookMarker(layout, "ask", currentRow, askLevels.length);
    askLevels.forEach((level) => {
      appendOrderBookLevel(layout, level, currentRow);
      currentRow += 1;
    });
  }

  if (bidLevels.length) {
    appendOrderBookMarker(layout, "bid", currentRow, bidLevels.length);
    bidLevels.forEach((level) => {
      appendOrderBookLevel(layout, level, currentRow);
      currentRow += 1;
    });
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

  renderOrderBook(realtime);

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
    refreshPriceDisplay();
    if (lastChartData) {
      renderChart(lastChartData);
    }
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

function buildFixedTimeAxis(points) {
  const labels = [];
  const prices = [];
  const pointMap = new Map(points.map((point) => [point.time, point.price]));

  for (let minute = 9 * 60; minute <= 13 * 60 + 25; minute += 1) {
    const hour = String(Math.floor(minute / 60)).padStart(2, "0");
    const minutePart = String(minute % 60).padStart(2, "0");
    const label = `${hour}:${minutePart}`;
    labels.push(label);
    prices.push(pointMap.has(label) ? pointMap.get(label) : null);
  }

  return { labels, prices };
}

function getNearestAvailablePrice(values, index) {
  if (hasValue(values[index])) {
    return values[index];
  }

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (hasValue(values[cursor])) {
      return values[cursor];
    }
  }

  for (let cursor = index + 1; cursor < values.length; cursor += 1) {
    if (hasValue(values[cursor])) {
      return values[cursor];
    }
  }

  return null;
}

function getLastAvailablePrice(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (hasValue(values[index])) {
      return values[index];
    }
  }

  return null;
}

function renderChart(data) {
  lastChartData = data;
  const points = data.points || [];
  const prevClose = data.prev_close;
  const hasPrevClose = prevClose !== null && prevClose !== undefined;

  chartPrevClose.textContent = hasPrevClose
    ? `昨收 ${Number(prevClose).toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
    : "";

  if (!points.length) {
    if (priceChart) {
      priceChart.destroy();
      priceChart = null;
    }
    chartLegend.classList.add("hidden");
    setChartMessage(data.message || "尚無當日走勢資料");
    return;
  }

  chartLegend.classList.remove("hidden");
  chartLegendTrade?.classList.toggle("hidden", hasPrevClose);
  chartLegendUp?.classList.toggle("hidden", !hasPrevClose);
  chartLegendDown?.classList.toggle("hidden", !hasPrevClose);
  chartLegendPrev?.classList.toggle("hidden", !hasPrevClose);
  updateChartLegendColors();
  setChartMessage("");

  const { labels, prices } = buildFixedTimeAxis(points);
  const canvas = document.getElementById("price-chart");
  const ctx = canvas.getContext("2d");

  if (priceChart) {
    priceChart.destroy();
  }

  const fallbackColors = getChartTrendColors(getLastAvailablePrice(prices), prevClose);

  const datasets = [
    {
      label: "成交價",
      data: prices,
      borderColor: fallbackColors.borderColor,
      backgroundColor: fallbackColors.backgroundColor,
      segment: hasPrevClose ? buildPriceSegmentStyle(prevClose) : undefined,
      fill: true,
      tension: 0.2,
      pointRadius: 0,
      borderWidth: 2,
    },
  ];

  if (hasPrevClose) {
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
      spanGaps: true,
      layout: {
        padding: 0,
      },
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: true,
          callbacks: {
            label: (context) => {
              const datasetLabel = context.dataset?.label || "價格";
              const values = context.chart?.data?.datasets?.[context.datasetIndex]?.data || [];
              const rawValue = context.parsed?.y;

              if (datasetLabel === "昨收") {
                return hasValue(rawValue)
                  ? `昨收 ${Number(rawValue).toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
                  : null;
              }

              const resolvedValue = (() => {
                if (hasValue(rawValue)) {
                  return rawValue;
                }

                const nearestValue = getNearestAvailablePrice(values, context.dataIndex);
                return hasValue(nearestValue) ? nearestValue : null;
              })();

              if (!hasValue(resolvedValue)) {
                return null;
              }

              return `成交價 ${Number(resolvedValue).toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
            },
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
    chartLegend.classList.add("hidden");
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

  stockPanel.classList.remove("hidden");
  errorPanel.classList.add("hidden");
  document.getElementById("display-code").textContent = normalizedCode;

  document.getElementById("display-trade-volume").textContent = "—";
  document.getElementById("display-accum-volume").textContent = "—";
  document.getElementById("display-open").textContent = "—";
  document.getElementById("display-high").textContent = "—";
  document.getElementById("display-low").textContent = "—";
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
