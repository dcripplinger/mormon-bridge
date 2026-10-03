import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.mormonbridge.app',
  appName: 'Mormon Bridge',
  webDir: 'dist',
  // Server config for live reload during development (remove for production builds)
  // server: {
  //   url: 'http://YOUR_LOCAL_IP:5173',
  //   cleartext: true,
  // },
}

export default config
