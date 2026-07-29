const { defaultStock, refreshSeconds } = window.STOCK_CONFIG;

const stockInput = document.getElementById("stock-code");
const stockSuggestions = document.getElementById("stock-suggestions");
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
let lastDisplayPriceTime = null;
let hasClosingPrice = false;
let invertColors = localStorage.getItem("invertColors") !== "false";
let suggestionResults = [];
let activeSuggestionIndex = -1;
let suggestionTimer = null;
let suggestionRequestId = 0;
let chartRequestId = 0;

const SUGGESTION_DEBOUNCE_MS = 200;

const CHART_REFRESH_SECONDS = 60;
const CHART_SLOW_REFRESH_SECONDS = 300;

function getTaipeiNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function isWeekday() {
  const day = getTaipeiNow().getDay();
  return day !== 0 && day !== 6;
}

function getTaipeiMinutes() {
  const taipei = getTaipeiNow();
  return taipei.getHours() * 60 + taipei.getMinutes();
}

function isPreMarketTrial() {
  if (!isWeekday()) {
    return false;
  }
  const minutes = getTaipeiMinutes();
  return minutes >= 8 * 60 + 30 && minutes < 9 * 60;
}

function isRegularTradingHours() {
  if (!isWeekday()) {
    return false;
  }
  const minutes = getTaipeiMinutes();
  return minutes >= 9 * 60 && minutes < 13 * 60 + 30;
}

function isTradingHours() {
  return isPreMarketTrial() || isRegularTradingHours();
}

function isTrialMatchingMinutes(minutes) {
  const preMarketStart = 8 * 60 + 30;
  const preMarketEnd = 9 * 60;
  const closeTrialStart = 13 * 60 + 25;
  const closeTrialEnd = 13 * 60 + 30;
  return (
    (minutes >= preMarketStart && minutes < preMarketEnd) ||
    (minutes >= closeTrialStart && minutes <= closeTrialEnd)
  );
}

function parseDisplayPriceMinutes(priceTime) {
  if (!priceTime) {
    return null;
  }

  if (typeof priceTime === "string") {
    const timeMatch = priceTime.match(/(\d{1,2}):(\d{2})/);
    if (!timeMatch) {
      return null;
    }
    return Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
  }

  if (priceTime instanceof Date && !Number.isNaN(priceTime.getTime())) {
    return priceTime.getHours() * 60 + priceTime.getMinutes();
  }

  return null;
}

function formatChartPointTime(hhmm) {
  const taipei = getTaipeiNow();
  const year = taipei.getFullYear();
  const month = String(taipei.getMonth() + 1).padStart(2, "0");
  const day = String(taipei.getDate()).padStart(2, "0");
  return `${year}-${month}-${day} ${hhmm}:00`;
}

function formatDisplayPriceTime(priceTime) {
  if (!priceTime) {
    return "";
  }

  if (typeof priceTime === "string") {
    if (/^\d{2}:\d{2}$/.test(priceTime)) {
      return formatChartPointTime(priceTime);
    }
    return priceTime;
  }

  if (priceTime instanceof Date && !Number.isNaN(priceTime.getTime())) {
    const year = priceTime.getFullYear();
    const month = String(priceTime.getMonth() + 1).padStart(2, "0");
    const day = String(priceTime.getDate()).padStart(2, "0");
    const hours = String(priceTime.getHours()).padStart(2, "0");
    const minutes = String(priceTime.getMinutes()).padStart(2, "0");
    const seconds = String(priceTime.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  return "";
}

function updateDisplayTime() {
  const timeText = formatDisplayPriceTime(lastDisplayPriceTime);
  document.getElementById("display-time").textContent = timeText ? `更新時間：${timeText}` : "";
}

function hasChartPriceAtTime(chartData, timeLabel) {
  const points = chartData?.points || [];
  return points.some((point) => point.time === timeLabel);
}

function getChartPointAtTime(chartData, timeLabel) {
  const points = chartData?.points || [];
  return points.find((point) => point.time === timeLabel) || null;
}

function getLatestChartPoint(chartData) {
  const points = chartData?.points || [];
  if (!points.length) {
    return null;
  }
  return points[points.length - 1];
}

function hasRegularSessionChartPoint(chartData) {
  return (chartData?.points || []).some((point) => {
    const minutes = parseDisplayPriceMinutes(point.time);
    return minutes !== null && minutes >= 9 * 60 && minutes <= 13 * 60 + 24;
  });
}

function canAppendClosingPriceToChart(chartData = lastChartData) {
  if (!hasClosingPrice || !hasValue(lastLatestPrice) || !chartData) {
    return false;
  }

  if (hasChartPriceAtTime(chartData, "13:30")) {
    return false;
  }

  if (hasChartPriceAtTime(chartData, "13:24")) {
    return true;
  }

  return (
    isWeekday() &&
    getTaipeiMinutes() >= 13 * 60 + 45 &&
    hasRegularSessionChartPoint(chartData)
  );
}

function mergeRealtimeClosingPriceIntoChartData(data) {
  if (!canAppendClosingPriceToChart(data)) {
    return data;
  }

  const points = data.points || [];
  const withoutClosing = points.filter((point) => point.time !== "13:30");

  return {
    ...data,
    points: [...withoutClosing, { time: "13:30", price: Number(lastLatestPrice) }],
  };
}

function applyRealtimeClosingPriceToChart() {
  if (!lastChartData || !canAppendClosingPriceToChart(lastChartData)) {
    return;
  }

  renderChart(lastChartData, currentCode);
}

function detectClosingPriceFromRealtime(info) {
  const minutes = parseDisplayPriceMinutes(info?.time);
  return minutes !== null && minutes >= 13 * 60 + 30;
}

function refreshClosingPriceState(realtimeInfo) {
  if (hasClosingPrice) {
    return;
  }

  if (lastChartData && hasChartPriceAtTime(lastChartData, "13:30")) {
    hasClosingPrice = true;
    return;
  }

  if (detectClosingPriceFromRealtime(realtimeInfo)) {
    hasClosingPrice = true;
  }
}

function isPostCloseWaitingFor1330() {
  if (!isWeekday()) {
    return false;
  }
  return getTaipeiMinutes() >= 13 * 60 + 30 && !hasClosingPrice;
}

function shouldContinueRealtimeRefresh() {
  return isTradingHours() || isPostCloseWaitingFor1330();
}

function shouldContinueChartRefresh() {
  if (!isWeekday()) {
    return false;
  }

  if (getTaipeiMinutes() >= 14 * 60) {
    return false;
  }

  if (lastChartData && hasChartPriceAtTime(lastChartData, "13:30")) {
    return false;
  }

  return true;
}

function getChartRefreshSeconds() {
  if (!lastChartData) {
    return CHART_REFRESH_SECONDS;
  }

  if (hasChartPriceAtTime(lastChartData, "13:24")) {
    return CHART_SLOW_REFRESH_SECONDS;
  }

  if (
    getTaipeiMinutes() >= 13 * 60 + 45 &&
    hasRegularSessionChartPoint(lastChartData) &&
    !hasChartPriceAtTime(lastChartData, "13:30")
  ) {
    return CHART_SLOW_REFRESH_SECONDS;
  }

  return CHART_REFRESH_SECONDS;
}

function stopChartRefresh() {
  if (chartTimer) {
    clearTimeout(chartTimer);
    chartTimer = null;
  }
}

function scheduleChartRefresh() {
  stopChartRefresh();

  if (!shouldContinueChartRefresh()) {
    return;
  }

  chartTimer = setTimeout(async () => {
    chartTimer = null;
    await fetchChart(currentCode);
  }, getChartRefreshSeconds() * 1000);
}

function applyChartPriceFallback() {
  if (!lastChartData) {
    return;
  }

  const latestPoint = getLatestChartPoint(lastChartData);
  if (!latestPoint) {
    return;
  }

  if (!hasValue(lastLatestPrice)) {
    lastLatestPrice = latestPoint.price;
    lastDisplayPriceTime = latestPoint.time;
    refreshPriceDisplay();
    updateDisplayTime();
    updatePriceLabel();
  }
}

function applyClosingPriceDisplay() {
  if (!hasClosingPrice) {
    return false;
  }

  const closingPoint = getChartPointAtTime(lastChartData, "13:30");
  if (closingPoint) {
    lastLatestPrice = closingPoint.price;
    lastDisplayPriceTime = closingPoint.time;
    refreshPriceDisplay();
    updateDisplayTime();
    updatePriceLabel();
    return true;
  }

  return false;
}

function handleMarketStateAfterUpdate(code) {
  refreshClosingPriceState();

  if (hasClosingPrice) {
    applyClosingPriceDisplay();
  }

  if (shouldContinueRealtimeRefresh()) {
    setMarketOpenStatus(code);
    resetCountdown();
    startCountdown();
    return;
  }

  stopAllRefresh();
  setMarketClosedStatus(code);
}

function stopAllRefresh() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  stopChartRefresh();
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
  if (hasClosingPrice) {
    priceLabelEl.textContent = "收盤價";
    return;
  }

  const priceMinutes = parseDisplayPriceMinutes(lastDisplayPriceTime);
  if (priceMinutes !== null && isTrialMatchingMinutes(priceMinutes)) {
    priceLabelEl.textContent = "最近試撮價";
    return;
  }

  priceLabelEl.textContent = "最近成交價";
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

function hideSuggestions() {
  suggestionResults = [];
  activeSuggestionIndex = -1;
  stockSuggestions.innerHTML = "";
  stockSuggestions.classList.add("hidden");
  stockInput.setAttribute("aria-expanded", "false");
}

function renderSuggestions() {
  stockSuggestions.innerHTML = "";

  if (!suggestionResults.length) {
    stockSuggestions.classList.add("hidden");
    stockInput.setAttribute("aria-expanded", "false");
    return;
  }

  suggestionResults.forEach((item, index) => {
    const option = document.createElement("li");
    option.className = `stock-suggestion${index === activeSuggestionIndex ? " active" : ""}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(index === activeSuggestionIndex));
    option.dataset.code = item.code;
    option.innerHTML = `
      <span class="stock-suggestion-code">${item.code}</span>
      <span class="stock-suggestion-name">${item.name}</span>
      <span class="stock-suggestion-market">${item.market || ""}</span>
    `;
    option.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectSuggestion(item);
    });
    stockSuggestions.appendChild(option);
  });

  stockSuggestions.classList.remove("hidden");
  stockInput.setAttribute("aria-expanded", "true");
}

async function fetchSuggestions(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    hideSuggestions();
    return;
  }

  const requestId = ++suggestionRequestId;

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
    const data = await response.json();

    if (requestId !== suggestionRequestId) {
      return;
    }

    if (!response.ok || !data.success) {
      hideSuggestions();
      return;
    }

    suggestionResults = data.results || [];
    activeSuggestionIndex = suggestionResults.length ? 0 : -1;
    renderSuggestions();
  } catch {
    if (requestId === suggestionRequestId) {
      hideSuggestions();
    }
  }
}

function scheduleSuggestionFetch(query) {
  if (suggestionTimer) {
    clearTimeout(suggestionTimer);
  }

  suggestionTimer = setTimeout(() => {
    suggestionTimer = null;
    fetchSuggestions(query);
  }, SUGGESTION_DEBOUNCE_MS);
}

function selectSuggestion(item) {
  stockInput.value = item.code;
  hideSuggestions();
  handleSearch();
}

function moveSuggestionSelection(direction) {
  if (!suggestionResults.length) {
    return;
  }

  if (activeSuggestionIndex < 0) {
    activeSuggestionIndex = direction > 0 ? 0 : suggestionResults.length - 1;
  } else {
    activeSuggestionIndex =
      (activeSuggestionIndex + direction + suggestionResults.length) %
      suggestionResults.length;
  }

  const selected = suggestionResults[activeSuggestionIndex];
  if (selected) {
    stockInput.value = selected.code;
  }
  renderSuggestions();
}

function initStockAutocomplete() {
  stockInput.addEventListener("input", () => {
    scheduleSuggestionFetch(stockInput.value);
  });

  stockInput.addEventListener("focus", () => {
    if (stockInput.value.trim()) {
      scheduleSuggestionFetch(stockInput.value);
    }
  });

  stockInput.addEventListener("blur", () => {
    setTimeout(hideSuggestions, 120);
  });

  stockInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      if (suggestionResults.length) {
        event.preventDefault();
        moveSuggestionSelection(1);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      if (suggestionResults.length) {
        event.preventDefault();
        moveSuggestionSelection(-1);
      }
      return;
    }

    if (event.key === "Escape") {
      hideSuggestions();
      return;
    }

    if (event.key === "Enter") {
      if (activeSuggestionIndex >= 0 && suggestionResults[activeSuggestionIndex]) {
        event.preventDefault();
        selectSuggestion(suggestionResults[activeSuggestionIndex]);
        return;
      }
      handleSearch();
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-input-wrap")) {
      hideSuggestions();
    }
  });
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "" && value !== "-";
}

function resetStockDisplayCache() {
  lastLatestPrice = null;
  lastTradeVolume = null;
  lastPrevClose = null;
  lastDisplayPriceTime = null;
  hasClosingPrice = false;
  lastChartData = null;
}

function resetChartState() {
  stopChartRefresh();
  if (priceChart) {
    priceChart.destroy();
    priceChart = null;
  }
  chartPrevClose.textContent = "";
  chartLegend.classList.add("hidden");
  setChartMessage("");
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

  if (hasValue(prevClose)) {
    lastPrevClose = prevClose;
  }
  if (hasValue(latest)) {
    lastLatestPrice = latest;
    if (hasValue(info.time)) {
      lastDisplayPriceTime = info.time;
    }
  }
  if (hasValue(realtime.trade_volume)) {
    lastTradeVolume = realtime.trade_volume;
  }

  refreshClosingPriceState(info);
  if (!hasValue(latest)) {
    applyChartPriceFallback();
  }
  applyRealtimeClosingPriceToChart();
  if (hasClosingPrice) {
    applyClosingPriceDisplay();
  }

  updatePriceLabel();

  document.getElementById("display-code").textContent = info.code || currentCode;
  document.getElementById("display-name").textContent = info.name || "—";
  document.getElementById("display-fullname").textContent = info.fullname || "";
  updateDisplayTime();

  const priceEl = document.getElementById("display-price");
  const changeEl = document.getElementById("display-change");

  if (hasValue(lastLatestPrice)) {
    refreshPriceDisplay();
  } else {
    priceEl.textContent = "";
    changeEl.textContent = "";
    changeEl.className = "price-change flat";
  }

  setComparedStatValue("display-open", realtime.open);
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
      renderChart(lastChartData, currentCode);
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

  for (let minute = 9 * 60; minute <= 13 * 60 + 24; minute += 1) {
    const hour = String(Math.floor(minute / 60)).padStart(2, "0");
    const minutePart = String(minute % 60).padStart(2, "0");
    const label = `${hour}:${minutePart}`;
    labels.push(label);
    prices.push(pointMap.has(label) ? pointMap.get(label) : null);
  }

  labels.push("13:30");
  prices.push(pointMap.has("13:30") ? pointMap.get("13:30") : null);

  return { labels, prices };
}

const CHART_AXIS_TICK_LABELS = new Set(["09:00", "10:00", "11:00", "12:00", "13:00", "13:30"]);

function getChartXAxisTicksConfig() {
  return {
    color: "#8b9bb8",
    autoSkip: false,
    maxRotation: 0,
    callback(value) {
      const label = this.getLabelForValue(value);
      return CHART_AXIS_TICK_LABELS.has(label) ? label : "";
    },
  };
}

function getNearestAvailableIndex(values, index) {
  if (hasValue(values[index])) {
    return index;
  }

  let nearestIndex = -1;
  let nearestDistance = Infinity;

  for (let cursor = 0; cursor < values.length; cursor += 1) {
    if (!hasValue(values[cursor])) {
      continue;
    }

    const distance = Math.abs(cursor - index);
    if (
      distance < nearestDistance ||
      (distance === nearestDistance && cursor < nearestIndex)
    ) {
      nearestDistance = distance;
      nearestIndex = cursor;
    }
  }

  return nearestIndex;
}

function getNearestAvailablePrice(values, index) {
  const nearestIndex = getNearestAvailableIndex(values, index);
  return nearestIndex >= 0 ? values[nearestIndex] : null;
}

function getLastAvailablePrice(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (hasValue(values[index])) {
      return values[index];
    }
  }

  return null;
}

function getTradeDatasetIndex(chart) {
  return chart.data.datasets.findIndex((dataset) => dataset.label === "成交價");
}

function getHoveredIndex(chart, xPixel) {
  const xScale = chart.scales.x;
  if (!xScale) {
    return -1;
  }

  const rawIndex = xScale.getValueForPixel(xPixel);
  if (!Number.isFinite(rawIndex)) {
    return -1;
  }

  return Math.max(0, Math.min(chart.data.labels.length - 1, Math.round(rawIndex)));
}

function buildSnappedActiveElements(chart, snappedIndex) {
  const activeElements = [];
  const tradeDatasetIndex = getTradeDatasetIndex(chart);
  if (tradeDatasetIndex >= 0) {
    activeElements.push({ datasetIndex: tradeDatasetIndex, index: snappedIndex });
  }

  const prevCloseDatasetIndex = chart.data.datasets.findIndex(
    (dataset) => dataset.label === "昨收"
  );
  if (prevCloseDatasetIndex >= 0) {
    activeElements.push({ datasetIndex: prevCloseDatasetIndex, index: snappedIndex });
  }

  return activeElements;
}

function resolveTooltipTradePrice(context) {
  const values = context.chart?.data?.datasets?.[context.datasetIndex]?.data || [];
  const rawValue = context.parsed?.y;
  return hasValue(rawValue) ? rawValue : getNearestAvailablePrice(values, context.dataIndex);
}

const chartSnapInteractionPlugin = {
  id: "chartSnapInteraction",
  beforeEvent(chart, args) {
    const { event, inChartArea } = args;
    const leaveEvents = new Set(["mouseout", "pointerleave", "pointerout"]);

    if (!inChartArea || leaveEvents.has(event.type)) {
      chart.$snappedIndex = undefined;
      return;
    }

    if (event.type !== "mousemove" && event.type !== "pointermove") {
      return;
    }

    const tradeDatasetIndex = getTradeDatasetIndex(chart);
    if (tradeDatasetIndex < 0) {
      return;
    }

    const values = chart.data.datasets[tradeDatasetIndex].data;
    const hoveredIndex = getHoveredIndex(chart, event.x);
    chart.$snappedIndex = getNearestAvailableIndex(values, hoveredIndex);
  },
  afterEvent(chart, args) {
    const { event, inChartArea } = args;
    const leaveEvents = new Set(["mouseout", "pointerleave", "pointerout"]);

    if (!inChartArea || leaveEvents.has(event.type)) {
      chart.$snappedIndex = undefined;
      chart.setActiveElements([]);
      chart.tooltip?.setActiveElements([], { x: event.x, y: event.y });
      args.changed = true;
      return;
    }

    if (event.type !== "mousemove" && event.type !== "pointermove") {
      return;
    }

    const tradeDatasetIndex = getTradeDatasetIndex(chart);
    if (tradeDatasetIndex < 0) {
      return;
    }

    const values = chart.data.datasets[tradeDatasetIndex].data;
    const hoveredIndex = getHoveredIndex(chart, event.x);
    const snappedIndex = getNearestAvailableIndex(values, hoveredIndex);
    if (snappedIndex < 0) {
      chart.$snappedIndex = undefined;
      chart.setActiveElements([]);
      chart.tooltip?.setActiveElements([], { x: event.x, y: event.y });
      args.changed = true;
      return;
    }

    chart.$snappedIndex = snappedIndex;
    const activeElements = buildSnappedActiveElements(chart, snappedIndex);
    chart.setActiveElements(activeElements);
    chart.tooltip?.setActiveElements(activeElements, { x: event.x, y: event.y });
    args.changed = true;
  },
  afterDraw(chart) {
    const snappedIndex = chart.$snappedIndex;
    if (snappedIndex === undefined) {
      return;
    }

    const tradeDatasetIndex = getTradeDatasetIndex(chart);
    if (tradeDatasetIndex < 0) {
      return;
    }

    const element = chart.getDatasetMeta(tradeDatasetIndex).data[snappedIndex];
    if (!element || element.x == null || element.y == null) {
      return;
    }

    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(element.x, chartArea.top);
    ctx.lineTo(element.x, chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
    ctx.setLineDash([4, 4]);
    ctx.stroke();

    const price = chart.data.datasets[tradeDatasetIndex].data[snappedIndex];
    const hoverColor = getChartTrendColors(price, chart.$prevClose).borderColor;
    ctx.beginPath();
    ctx.arc(element.x, element.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = hoverColor;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0f172a";
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
  },
};

function syncChartRefreshSchedule() {
  if (shouldContinueChartRefresh()) {
    scheduleChartRefresh();
  } else {
    stopChartRefresh();
  }
}

function renderChart(data, expectedCode = currentCode) {
  if (expectedCode !== currentCode) {
    return;
  }

  const chartData = mergeRealtimeClosingPriceIntoChartData(data);
  lastChartData = chartData;
  const points = chartData.points || [];
  const prevClose = chartData.prev_close;
  const hasPrevClose = prevClose !== null && prevClose !== undefined;

  refreshClosingPriceState();
  if (!hasValue(lastLatestPrice)) {
    applyChartPriceFallback();
  }
  if (hasClosingPrice) {
    applyClosingPriceDisplay();
    handleMarketStateAfterUpdate(currentCode);
  }

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
    syncChartRefreshSchedule();
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
  const fallbackColors = getChartTrendColors(getLastAvailablePrice(prices), prevClose);

  if (priceChart) {
    priceChart.data.labels = labels;
    priceChart.data.datasets[0].data = prices;
    priceChart.data.datasets[0].borderColor = fallbackColors.borderColor;
    priceChart.data.datasets[0].backgroundColor = fallbackColors.backgroundColor;
    priceChart.data.datasets[0].segment = hasPrevClose ? buildPriceSegmentStyle(prevClose) : undefined;

    const prevDataset = priceChart.data.datasets.find((dataset) => dataset.label === "昨收");
    if (hasPrevClose) {
      const prevCloseData = labels.map(() => prevClose);
      if (prevDataset) {
        prevDataset.data = prevCloseData;
      } else {
        priceChart.data.datasets.push({
          label: "昨收",
          data: prevCloseData,
          borderColor: "#94a3b8",
          borderDash: [6, 4],
          pointRadius: 0,
          borderWidth: 1.5,
          fill: false,
        });
      }
    } else if (prevDataset) {
      priceChart.data.datasets = priceChart.data.datasets.filter(
        (dataset) => dataset.label !== "昨收"
      );
    }

    if (chartData.y_min !== undefined && chartData.y_max !== undefined) {
      priceChart.options.scales.y.min = chartData.y_min;
      priceChart.options.scales.y.max = chartData.y_max;
    }

    priceChart.$prevClose = prevClose;
    priceChart.update("none");
    syncChartRefreshSchedule();
    return;
  }

  const canvas = document.getElementById("price-chart");
  const ctx = canvas.getContext("2d");

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
      pointHoverRadius: 0,
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
    plugins: [chartSnapInteractionPlugin],
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      spanGaps: true,
      layout: {
        padding: 0,
      },
      interaction: {
        mode: "index",
        intersect: false,
        includeInvisible: true,
      },
      hover: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: true,
          filter: (tooltipItem) => {
            const datasetLabel = tooltipItem.dataset?.label;
            if (datasetLabel === "昨收") {
              return hasValue(tooltipItem.parsed?.y);
            }

            if (datasetLabel === "成交價") {
              const values = tooltipItem.chart?.data?.datasets?.[tooltipItem.datasetIndex]?.data || [];
              return getNearestAvailableIndex(values, tooltipItem.dataIndex) >= 0;
            }

            return hasValue(tooltipItem.parsed?.y);
          },
          callbacks: {
            title: (tooltipItems) => {
              const context = tooltipItems[0];
              if (!context) {
                return "";
              }

              const labels = context.chart?.data?.labels || [];
              const tradeDataset = context.chart?.data?.datasets?.find(
                (dataset) => dataset.label === "成交價"
              );
              if (!tradeDataset) {
                return labels[context.dataIndex] || "";
              }

              const nearestIndex = getNearestAvailableIndex(
                tradeDataset.data,
                context.dataIndex
              );
              if (nearestIndex >= 0) {
                return labels[nearestIndex] || "";
              }

              return labels[context.dataIndex] || "";
            },
            label: (context) => {
              const datasetLabel = context.dataset?.label || "價格";
              const rawValue = context.parsed?.y;

              if (datasetLabel === "昨收") {
                return hasValue(rawValue)
                  ? `昨收 ${Number(rawValue).toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
                  : null;
              }

              const resolvedValue = resolveTooltipTradePrice(context);

              if (!hasValue(resolvedValue)) {
                return null;
              }

              return `成交價 ${Number(resolvedValue).toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
            },
            labelColor: (context) => {
              const datasetLabel = context.dataset?.label;
              if (datasetLabel === "昨收") {
                return {
                  borderColor: "#94a3b8",
                  backgroundColor: "#94a3b8",
                };
              }

              const resolvedValue = resolveTooltipTradePrice(context);
              const color = getChartTrendColors(
                resolvedValue,
                context.chart?.$prevClose
              ).borderColor;

              return {
                borderColor: color,
                backgroundColor: color,
              };
            },
            labelTextColor: (context) => {
              const datasetLabel = context.dataset?.label;
              if (datasetLabel === "昨收") {
                return "#cbd5e1";
              }

              const resolvedValue = resolveTooltipTradePrice(context);
              return getChartTrendColors(resolvedValue, context.chart?.$prevClose).borderColor;
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
          ticks: getChartXAxisTicksConfig(),
          grid: {
            color: "rgba(36, 48, 73, 0.6)",
          },
        },
        y: {
          min: chartData.y_min,
          max: chartData.y_max,
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
  priceChart.$prevClose = prevClose;
  syncChartRefreshSchedule();
}

async function fetchChart(code) {
  const normalizedCode = code.trim();
  if (!normalizedCode) {
    return;
  }

  const requestId = chartRequestId;
  const requestedCode = normalizedCode;

  try {
    const response = await fetch(`/api/chart?code=${encodeURIComponent(normalizedCode)}`);
    const data = await response.json();

    if (requestId !== chartRequestId || requestedCode !== currentCode) {
      return;
    }

    if (!response.ok || !data.success) {
      throw new Error(data.message || "無法取得走勢資料");
    }

    renderChart(data, requestedCode);
  } catch (error) {
    if (requestId !== chartRequestId || requestedCode !== currentCode) {
      return;
    }

    resetChartState();
    setChartMessage(error.message || "走勢圖載入失敗");
    syncChartRefreshSchedule();
  }
}

function startChartRefresh() {
  scheduleChartRefresh();
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
  if (!shouldContinueRealtimeRefresh()) {
    return;
  }

  if (countdownTimer) {
    clearInterval(countdownTimer);
  }

  resetCountdown();
  countdownTimer = setInterval(() => {
    if (!shouldContinueRealtimeRefresh()) {
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
    showError("請輸入股票代號或公司名稱");
    return;
  }

  if (!manual && !shouldContinueRealtimeRefresh()) {
    return;
  }

  if (isFetching) {
    return;
  }

  const stockChanged = normalizedCode !== currentCode;
  isFetching = true;
  currentCode = normalizedCode;

  if (stockChanged) {
    chartRequestId += 1;
    resetStockDisplayCache();
    resetChartState();
  }

  stockPanel.classList.remove("hidden");
  errorPanel.classList.add("hidden");
  document.getElementById("display-code").textContent = normalizedCode;

  statusText.textContent = manual ? `正在查詢 ${normalizedCode}...` : `正在更新 ${normalizedCode}...`;

  try {
    const response = await fetch(`/api/stock?code=${encodeURIComponent(normalizedCode)}`);
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || "無法取得股票資料");
    }

    const resolvedCode = data.info?.code || normalizedCode;
    currentCode = resolvedCode;
    stockInput.value = resolvedCode;

    renderStock(data);
    handleMarketStateAfterUpdate(resolvedCode);

    if (manual || stockChanged) {
      fetchChart(resolvedCode);
      if (shouldContinueChartRefresh()) {
        startChartRefresh();
      }
    }
  } catch (error) {
    showError(error.message || "查詢失敗，請稍後再試");

    if (shouldContinueRealtimeRefresh()) {
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
  hideSuggestions();
  document.getElementById("display-trade-volume").textContent = "—";
  document.getElementById("display-accum-volume").textContent = "—";
  document.getElementById("display-open").textContent = "—";
  document.getElementById("display-high").textContent = "—";
  document.getElementById("display-low").textContent = "—";
  fetchStock(stockInput.value, true);
}

searchBtn.addEventListener("click", handleSearch);

fetchStock(defaultStock, true);
initColorToggle();
initStockAutocomplete();
