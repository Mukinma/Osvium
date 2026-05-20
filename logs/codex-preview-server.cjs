const http = require("http");
const fs = require("fs");
const path = require("path");
const baseDir = "C:/Users/ximen/Desktop/Vireom";
const mime = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp"};
http.createServer((req,res)=>{
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1:5177");
    if (url.pathname === "/" || url.pathname === "/admin") {
      let html = fs.readFileSync(path.join(baseDir, "frontend/templates/admin.html"), "utf8");
      html = html.replace(/\{%\s*include\s+"[^"]+"\s*%\}/g, "");
      html = html.replace(/\{\{\s*asset_version\s*\}\}/g, "dev");
      html = html.replace(/\{\{\s*admin_user\s*\|\s*e\s*\}\}/g, "admin");
      html = html.replace(/\{\{\s*csrf_token\s*\|\s*e\s*\}\}/g, "preview-token");
      res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"});
      res.end(html);
      return;
    }
    if (url.pathname.startsWith("/static/")) {
      const relative = url.pathname.replace(/^\/static\//, "");
      const filePath = path.join(baseDir, "frontend/static", relative);
      res.writeHead(200, {"Content-Type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream"});
      res.end(fs.readFileSync(filePath));
      return;
    }
    res.writeHead(404); res.end("Not found");
  } catch (error) {
    res.writeHead(500, {"Content-Type":"text/plain; charset=utf-8"});
    res.end(String(error.stack || error));
  }
}).listen(5177, "127.0.0.1", () => console.log("preview listening on http://127.0.0.1:5177/admin"));
