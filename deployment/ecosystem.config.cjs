// PM2 process definition for the QSA ERP web app.
//
// The app is a Next.js production server, so it runs under a process manager
// rather than as a bare `next start`. This file is a CJS module on purpose:
// the repository root is "type": "commonjs", and PM2 reads this file directly.
//
//   pm2 start deployment/ecosystem.config.cjs --env production
//   pm2 save
//   pm2 startup            # run the command it prints, once, as root
//
// After the first `pm2 startup`, the app comes back on reboot without any
// further work. Verify with `pm2 resurrect` on a test reboot.
//
// Environment variables are not written here. They belong in
// `web/.env.production.local`, which is gitignored, so credentials never reach
// the repository. Next.js reads that file at build time for NEXT_PUBLIC_*
// values, which means the app has to be rebuilt whenever the Supabase URL or
// publishable key changes.

module.exports = {
  apps: [
    {
      name: "qsa-web",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      cwd: "./web",
      // Matches the Nginx upstream below. Change both together or the app
      // answers on a port nothing is proxying to.
      env: {
        NODE_ENV: "production",
        PORT: 3100,
      },
      // A Next.js server serves every request from one process's event loop, so
      // the useful lever is more processes, not more threads. One per core.
      instances: "max",
      exec_mode: "cluster",
      autorestart: true,
      max_restarts: 10,
      // A restart loop should surface in the log rather than being retried
      // forever in the background.
      min_uptime: "20s",
      restart_delay: 2000,
      // Reload on every deploy so a zero-downtime cutover does not need a
      // stop/start gap.
      wait_ready: false,
      kill_timeout: 5000,
      listen_timeout: 10000,
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      merge_logs: true,
      time: true,
      max_log_size: "10M",
      logrotate: {
        max_files: 5,
        compress: true,
      },
    },
  ],
};
