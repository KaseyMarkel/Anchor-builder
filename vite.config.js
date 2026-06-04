import { defineConfig } from 'vite'

// The vibe platform assigns a port in the team's allowed range and passes it in
// via PORT. allowedHosts:true lets the public Caddy hostname through.
const port = Number(process.env.PORT) || 5173

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port,
    strictPort: false,
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    port,
    allowedHosts: true
  }
})
