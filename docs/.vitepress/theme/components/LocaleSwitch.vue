<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, withBase } from 'vitepress'

const props = withDefaults(
  defineProps<{
    locale: 'en' | 'fr'
    translatedRoutes: string[]
    screenMenu?: boolean
  }>(),
  { screenMenu: false }
)

const route = useRoute()

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
const accessibleLabel = computed(() => {
  if (targetLocale.value === 'en') return 'Read this page in English'
  return hasEquivalentTranslation.value ? 'Lire cette page en français' : "Ouvrir l'accueil de la documentation française"
})
</script>

<template>
  <a class="LocaleSwitch" :class="{ 'is-screen-menu': screenMenu }" :href="withBase(targetPath)" :aria-label="accessibleLabel" :title="accessibleLabel" :lang="targetLocale" :hreflang="targetLocale">
    <span aria-hidden="true" class="LocaleSwitch__locale" :class="{ 'is-current': locale === 'en' }">EN</span>
    <span aria-hidden="true" class="LocaleSwitch__separator"></span>
    <span aria-hidden="true" class="LocaleSwitch__locale" :class="{ 'is-current': locale === 'fr' }">FR</span>
  </a>
</template>

<style scoped>
.LocaleSwitch {
  display: inline-flex;
  min-width: 58px;
  height: 36px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-left: 8px;
  padding: 0 4px;
  border-radius: 3px;
  color: var(--vp-c-text-1);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.06em;
}

.LocaleSwitch__locale {
  color: var(--vp-c-text-3);
  transition: color 140ms ease;
}

.LocaleSwitch__locale.is-current {
  color: var(--vp-c-brand-1);
}

.LocaleSwitch__separator {
  width: 1px;
  height: 13px;
  background: var(--vp-c-divider);
  transform: rotate(18deg);
}

.LocaleSwitch:hover .LocaleSwitch__locale,
.LocaleSwitch:focus-visible .LocaleSwitch__locale {
  color: var(--vp-c-text-1);
}

.LocaleSwitch:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.LocaleSwitch.is-screen-menu {
  width: fit-content;
  margin: 12px 0 0;
}

@media (prefers-reduced-motion: reduce) {
  .LocaleSwitch__locale {
    transition: none;
  }
}
</style>
