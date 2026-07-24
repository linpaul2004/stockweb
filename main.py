import os
from datetime import datetime
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, render_template, request
import twstock

from chart import get_intraday_chart, get_previous_close_for_code

app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False

DEFAULT_STOCK = "0050"
REFRESH_SECONDS = 3
TZ_TAIPEI = ZoneInfo("Asia/Taipei")


@app.route("/")
def index():
    return render_template("index.html", default_stock=DEFAULT_STOCK, refresh_seconds=REFRESH_SECONDS)


@app.route("/api/stock")
def get_stock():
    code = request.args.get("code", DEFAULT_STOCK).strip()
    if not code:
        return jsonify({"success": False, "message": "請輸入股票代號"}), 400

    data = twstock.realtime.get(code)
    if not data.get("success"):
        return jsonify(
            {
                "success": False,
                "message": data.get("rtmessage", "無法取得股票資料"),
                "rtcode": data.get("rtcode"),
            }
        ), 400

    prev_close = get_previous_close_for_code(code)
    if prev_close is not None:
        data["prev_close"] = prev_close

    timestamp = data.get("timestamp")
    if timestamp:
        data["info"]["time"] = datetime.fromtimestamp(timestamp, TZ_TAIPEI).strftime(
            "%Y-%m-%d %H:%M:%S"
        )

    return jsonify(data)


@app.route("/api/chart")
def get_chart():
    code = request.args.get("code", DEFAULT_STOCK).strip()
    if not code:
        return jsonify({"success": False, "message": "請輸入股票代號"}), 400

    try:
        return jsonify(get_intraday_chart(code))
    except Exception as exc:
        return jsonify({"success": False, "message": f"無法取得走勢資料：{exc}"}), 500


def main():
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() in {"1", "true", "yes"}
    app.run(debug=debug, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
