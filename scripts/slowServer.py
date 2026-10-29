#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
模拟 CDN 限速的静态服务器 —— 只为验证展示页在慢速网络下会不会露黑屏。

本机直连是千兆，加载 7.9MB 只要一瞬间，看不出问题；用户那边走 Cloudflare free
有速度限制，所以要人为把带宽压到几百 KB/s 才能复现"十几秒黑屏"的场景。

用法： python _slowserver.py <端口> <每秒字节数>
"""
import http.server
import functools
import sys
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8881
RATE = int(sys.argv[2]) if len(sys.argv) > 2 else 300 * 1024  # 默认 300 KB/s
LOG_PATH = sys.argv[4] if len(sys.argv) > 4 else "_access.log"
T0 = time.time()
open(LOG_PATH, "w", encoding="utf-8").close()


class ThrottledHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        """记录带时间戳的请求日志 —— 用来验证"预加载先跑完、bundle 最后才注入"这条时间线。"""
        msg = fmt % args
        try:
            with open(LOG_PATH, "a", encoding="utf-8") as f:
                f.write("%.3f\t%s\n" % (time.time() - T0, msg.split('"')[1] if '"' in msg else msg))
        except Exception:
            pass

    def copyfile(self, source, outputfile):
        """按固定速率吐字节。SimpleHTTPRequestHandler 内部走这个方法发响应体。"""
        sent = 0
        start = time.time()
        while True:
            chunk = source.read(16384)
            if not chunk:
                break
            outputfile.write(chunk)
            outputfile.flush()
            sent += len(chunk)
            # 已用时长 vs 按 RATE 应该用的时长，差多少睡多少
            target = sent / RATE
            elapsed = time.time() - start
            if target > elapsed:
                time.sleep(target - elapsed)
        return sent


if __name__ == "__main__":
    handler = functools.partial(ThrottledHandler, directory=sys.argv[3] if len(sys.argv) > 3 else ".")
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        httpd.serve_forever()
