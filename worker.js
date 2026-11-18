/**
 * Cloudflare Worker entrypoint for SnapVid.
 * Serves static assets from ./static (mapping /static/* and /admin),
 * provides SEO routes (/robots.txt, /sitemap.xml),
 * and proxies /api/* to env.BACKEND_URL (Python FastAPI + yt-dlp + FFmpeg backend).
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/robots.txt") {
      const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${url.origin}/sitemap.xml\n`;
      return new Response(body, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (pathname === "/sitemap.xml") {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${url.origin}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>`;
      return new Response(xml, {
        headers: { "content-type": "application/xml; charset=utf-8" },
      });
    }

    if (pathname.startsWith("/api/")) {
      const backendBase = (env.BACKEND_URL || "").trim().replace(/\/+$/, "");
      if (!backendBase) {
        return new Response(
          JSON.stringify({
            detail:
              "Máy chủ xử lý video (BACKEND_URL) chưa được liên kết trong Cloudflare Worker. Hãy cài đặt biến BACKEND_URL trỏ tới Hugging Face Spaces hoặc VPS của bạn.",
          }),
          {
            status: 503,
            headers: { "content-type": "application/json; charset=utf-8" },
          }
        );
      }

      const targetUrl = `${backendBase}${pathname}${url.search}`;
      const proxyHeaders = new Headers(request.headers);
      const clientIp = request.headers.get("cf-connecting-ip");
      if (clientIp) {
        proxyHeaders.set("x-forwarded-for", clientIp);
      }
      proxyHeaders.delete("host");

      const init = {
        method: request.method,
        headers: proxyHeaders,
        redirect: "manual",
      };
      if (!["GET", "HEAD"].includes(request.method)) {
        init.body = request.body;
      }

      return fetch(targetUrl, init);
    }

    // Rewrite /static/* -> /* and /admin -> /admin.html for ASSETS binding
    if (pathname.startsWith("/static/")) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = pathname.slice("/static".length);
      return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
    }

    if (pathname === "/admin") {
      const adminUrl = new URL(request.url);
      adminUrl.pathname = "/admin.html";
      return env.ASSETS.fetch(new Request(adminUrl.toString(), request));
    }

    return env.ASSETS.fetch(request);
  },
};
