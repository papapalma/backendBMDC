/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      // Security headers applied to every response (SEC-16, Req 21.6, 21.7)
      // TLS 1.2 minimum / TLS 1.3 preferred is enforced at the reverse proxy
      // level (Nginx, AWS ALB, Cloudflare). Recommended Nginx cipher config:
      //   ssl_protocols TLSv1.2 TLSv1.3;
      //   ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:
      //               ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:
      //               ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
      //   ssl_prefer_server_ciphers off;
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            // HSTS: 2 years, includeSubDomains, preload (Req 21.7)
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self' http://localhost:3003 ws://localhost:3001",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
      {
        // CORS for API routes.
        // In development the frontend runs on localhost — allow it explicitly.
        // In production FRONTEND_URL is the deployed origin.
        // Route handlers (cors.ts / withErrorHandler) still perform per-request
        // origin validation and will override this header for requests from
        // other allowed origins (e.g. localhost:5173).
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.FRONTEND_URL || (
              process.env.NODE_ENV === 'production'
                ? 'https://bmdc.site'
                : 'http://localhost:3001'
            ),
          },
          { key: 'Access-Control-Allow-Methods', value: 'GET,DELETE,PATCH,POST,PUT,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization' },
        ],
      },
      {
        // Allow CORS for uploaded files
        source: '/uploads/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.FRONTEND_URL || (
              process.env.NODE_ENV === 'production'
                ? 'https://bmdc.site'
                : 'http://localhost:3001'
            ),
          },
          { key: 'Access-Control-Allow-Methods', value: 'GET' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
