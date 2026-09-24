<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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
const menu = ref<HTMLDetailsElement | null>(null)

const currentRoute = computed(() => {
  const withoutLocale = route.path.replace(/^\/fr(?=\/|$)/, '') || '/'
  const withoutHtml = withoutLocale.replace(/\.html$/, '')
  return withoutHtml !== '/' ? withoutHtml.replace(/\/$/, '') : '/'
})

const pathForLocale = (locale: 'en' | 'fr'): string => {
  if (locale === 'en') return currentRoute.value
  if (!props.translatedRoutes.includes(currentRoute.value)) return '/fr/'
  return currentRoute.value === '/' ? '/fr/' : `/fr${currentRoute.value}`
}

const languageOptions = computed(() => [
  { code: 'en' as const, shortLabel: 'EN', label: 'English', path: pathForLocale('en') },
  { code: 'fr' as const, shortLabel: 'FR', label: 'Français', path: pathForLocale('fr') }
])

const menuLabel = computed(() => (props.locale === 'fr' ? 'Choisir la langue de la documentation' : 'Choose documentation language'))

const closeMenu = () => {
  if (menu.value) menu.value.open = false
}

const closeOnOutsideClick = (event: PointerEvent) => {
  if (menu.value?.open && !menu.value.contains(event.target as Node)) closeMenu()
}

onMounted(() => document.addEventListener('pointerdown', closeOnOutsideClick))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOnOutsideClick))
</script>

<template>
  <details ref="menu" class="LocaleSwitch" :class="{ 'is-screen-menu': screenMenu }" @keydown.esc.stop="closeMenu">
    <summary class="LocaleSwitch__trigger" :aria-label="menuLabel" :title="menuLabel">
      <span>{{ locale.toUpperCase() }}</span>
      <svg class="LocaleSwitch__chevron" viewBox="0 0 12 12" aria-hidden="true">
        <path d="m3 4.75 3 3 3-3" />
      </svg>
    </summary>

    <div class="LocaleSwitch__menu">
      <a
        v-for="option in languageOptions"
        :key="option.code"
        class="LocaleSwitch__option"
        :class="{ 'is-current': locale === option.code }"
        :href="withBase(option.path)"
        :lang="option.code"
        :hreflang="option.code"
        :aria-current="locale === option.code ? 'page' : undefined"
        @click="closeMenu"
      >
        <span class="LocaleSwitch__short-label">{{ option.shortLabel }}</span>
        <span class="LocaleSwitch__language">{{ option.label }}</span>
        <svg v-if="locale === option.code" class="LocaleSwitch__check" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m3.5 8.25 3 3 6-6" />
        </svg>
      </a>
    </div>
  </details>
</template>

<style scoped>
.LocaleSwitch {
  position: relative;
  display: inline-flex;
  height: var(--vp-nav-height);
  align-items: center;
  margin-left: 8px;
}

.LocaleSwitch__trigger {
  display: inline-flex;
  height: 36px;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 8px;
  border-radius: 6px;
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.03em;
  cursor: pointer;
  list-style: none;
  transition:
    color 140ms ease,
    background-color 140ms ease;
}

.LocaleSwitch__trigger::-webkit-details-marker {
  display: none;
}

.LocaleSwitch__trigger::marker {
  content: '';
}

.LocaleSwitch__trigger:hover,
.LocaleSwitch[open] .LocaleSwitch__trigger {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
}

.LocaleSwitch__trigger:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.LocaleSwitch__chevron {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.5;
  transition: transform 140ms ease;
}

.LocaleSwitch[open] .LocaleSwitch__chevron {
  transform: rotate(180deg);
}

.LocaleSwitch__menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  right: 0;
  min-width: 164px;
  padding: 6px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-elv, var(--vp-c-bg));
  box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
}

.LocaleSwitch__option {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 36px;
  padding: 0 9px;
  border-radius: 6px;
  color: var(--vp-c-text-2);
  font-size: 13px;
  text-decoration: none;
}

.LocaleSwitch__option:hover,
.LocaleSwitch__option:focus-visible {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
  outline: none;
}

.LocaleSwitch__option:focus-visible {
  box-shadow: inset 0 0 0 2px var(--vp-c-brand-1);
}

.LocaleSwitch__option.is-current {
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.LocaleSwitch__short-label {
  flex: 0 0 24px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.LocaleSwitch__language {
  flex: 1;
  font-weight: 550;
}

.LocaleSwitch__check {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}

.LocaleSwitch.is-screen-menu {
  display: block;
  width: 100%;
  height: auto;
  margin: 12px 0 0;
}

.LocaleSwitch.is-screen-menu .LocaleSwitch__trigger {
  width: 100%;
  justify-content: space-between;
}

.LocaleSwitch.is-screen-menu .LocaleSwitch__menu {
  position: static;
  margin-top: 6px;
  box-shadow: none;
}

@media (prefers-reduced-motion: reduce) {
  .LocaleSwitch__trigger,
  .LocaleSwitch__chevron {
    transition: none;
  }
}
</style>
