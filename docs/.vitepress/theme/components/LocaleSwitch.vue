<script setup lang="ts">
import { computed } from 'vue'
import { useData, useRoute, withBase } from 'vitepress'

const props = withDefaults(
  defineProps<{
    locale: 'en' | 'fr'
    translatedRoutes: string[]
    screenMenu?: boolean
  }>(),
  { screenMenu: false }
)

const route = useRoute()
const { hash } = useData()

const currentRoute = computed(() => {
  const withoutLocale = route.path.replace(/^\/fr(?=\/|$)/, '') || '/'
  const withoutHtml = withoutLocale.replace(/\.html$/, '')
  return withoutHtml !== '/' ? withoutHtml.replace(/\/$/, '') : '/'
})

const targetLocale = computed(() => (props.locale === 'fr' ? 'en' : 'fr'))
const hasEquivalentTranslation = computed(() => props.translatedRoutes.includes(currentRoute.value))
const targetPath = computed(() => {
  if (targetLocale.value === 'en') return currentRoute.value
  if (!hasEquivalentTranslation.value) return '/fr/'
  return currentRoute.value === '/' ? '/fr/' : `/fr${currentRoute.value}`
})
const targetLabel = computed(() => (targetLocale.value === 'fr' ? 'FR' : 'EN'))
const accessibleLabel = computed(() => {
  if (targetLocale.value === 'en') return 'Read this page in English'
  return hasEquivalentTranslation.value ? 'Lire cette page en français' : "Ouvrir l'accueil de la documentation française"
})
</script>

<template>
  <a
    class="LocaleSwitch"
    :class="{ 'is-screen-menu': screenMenu }"
    :href="withBase(`${targetPath}${hash}`)"
    :aria-label="accessibleLabel"
    :title="accessibleLabel"
    :lang="targetLocale"
    :hreflang="targetLocale"
  >
    <span aria-hidden="true" class="LocaleSwitch__mark">文</span>
    <span>{{ targetLabel }}</span>
  </a>
</template>

<style scoped>
.LocaleSwitch {
  display: inline-flex;
  min-width: 42px;
  height: 36px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-left: 10px;
  padding: 0 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  color: var(--vp-c-text-1);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  transition:
    border-color 160ms ease,
    color 160ms ease,
    background-color 160ms ease;
}

.LocaleSwitch:hover,
.LocaleSwitch:focus-visible {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.LocaleSwitch:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.LocaleSwitch__mark {
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0;
}

.LocaleSwitch.is-screen-menu {
  width: 100%;
  margin: 12px 0 0;
  justify-content: flex-start;
}

@media (prefers-reduced-motion: reduce) {
  .LocaleSwitch {
    transition: none;
  }
}
</style>
