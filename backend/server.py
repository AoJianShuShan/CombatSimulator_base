from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from backend.simulator import simulate_battle
from backend.validation import validate_battle_input


DEFAULT_HOST = os.getenv("HOST", "127.0.0.1")
DEFAULT_PORT = int(os.getenv("PORT", "8000"))


class BattleHttpServer(ThreadingHTTPServer):
    daemon_threads = True


class BattleRequestHandler(BaseHTTPRequestHandler):
    server_version = "CombatSimulatorHTTP/0.1"

    def do_OPTIONS(self) -> None:
        self._send_empty_response(HTTPStatus.NO_CONTENT)

    def do_GET(self) -> None:
        if self.path != "/health":
            self._send_json(HTTPStatus.NOT_FOUND, {"message": "Not Found"})
            return

        self._send_json(
            HTTPStatus.OK,
            {
                "status": "ok",
                "service": "combat-simulator-backend",
            },
        )

    def do_POST(self) -> None:
        if self.path != "/simulate":
            self._send_json(HTTPStatus.NOT_FOUND, {"message": "Not Found"})
            return

        try:
            payload = self._read_json_body()
            validate_battle_input(payload)
            result = simulate_battle(payload)
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            return
        except KeyError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"message": f"缺少字段: {error.args[0]}"})
            return
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"message": "请求体不是合法 JSON"})
            return

        self._send_json(HTTPStatus.OK, result)

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _read_json_body(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            raise ValueError("请求体不能为空")

        raw_body = self.rfile.read(content_length)
        payload = json.loads(raw_body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("请求体必须是对象")

        return payload

    def _send_empty_response(self, status: HTTPStatus) -> None:
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")


def run_server(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
    server = BattleHttpServer((host, port), BattleRequestHandler)
    print(f"Combat Simulator backend running on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    run_server()
