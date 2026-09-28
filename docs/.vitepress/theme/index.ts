import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import FoundrySystemMap from './components/FoundrySystemMap.vue'
import LocaleSwitch from './components/LocaleSwitch.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      'home-hero-image': () => h(FoundrySystemMap)
    })
  },
  enhanceApp({ app }) {
    app.component('LocaleSwitch', LocaleSwitch)
  }
} satisfies Theme
