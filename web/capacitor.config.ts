import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.mormonbridge.app',
  appName: 'Mormon Bridge',
  webDir: 'dist',
  // Deep links: share uses mormonbridge://join/<CODE> on native.
  // After `cap add android`, set strings.xml custom_url_scheme to "mormonbridge"
  // and ensure AndroidManifest has a VIEW/BROWSABLE intent-filter for that scheme.
  // Server config for live reload during development (remove for production builds)
  // server: {
  //   url: 'http://YOUR_LOCAL_IP:5173',
  //   cleartext: true,
  // },
}

export default config
