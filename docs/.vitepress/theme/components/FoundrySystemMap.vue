<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'

const { page } = useData()
const isFrench = computed(() => page.value.relativePath.startsWith('fr/'))

const copy = computed(() =>
  isFrench.value
    ? {
        eyebrow: 'DEUX PRODUITS, UN CONTRAT',
        title: 'Indépendants par conception. Plus rapides ensemble.',
        input: 'Votre projet SaaS',
        foundation: 'Fondation SaaS',
        foundationItems: ['Auth', 'RBAC', 'Données', 'Interface'],
        harness: 'Harness de développement',
        harnessItems: ['SRS', 'Tickets', 'Tests', 'Validation'],
        output: 'Prêt à évoluer',
        caption: 'Adoptez un rail ou combinez les deux sous le même contrat : .saasfoundry.json'
      }
    : {
        eyebrow: 'TWO PRODUCTS, ONE CONTRACT',
        title: 'Independent by design. Faster together.',
        input: 'Your SaaS project',
        foundation: 'SaaS foundation',
        foundationItems: ['Auth', 'RBAC', 'Data', 'Interface'],
        harness: 'Development harness',
        harnessItems: ['SRS', 'Tickets', 'Tests', 'Approval'],
        output: 'Ready to evolve',
        caption: 'Adopt either rail or combine both under one contract: .saasfoundry.json'
      }
)
</script>

<template>
  <figure class="sf-system-map" :aria-label="copy.title">
    <div class="sf-map-heading">
      <span>{{ copy.eyebrow }}</span>
      <strong>{{ copy.title }}</strong>
    </div>

    <div class="sf-map-input">
      <span class="sf-map-spark" aria-hidden="true"></span>
      <span>{{ copy.input }}</span>
    </div>

    <div class="sf-map-rails">
      <div class="sf-map-rail sf-map-rail--harness">
        <div class="sf-map-rail-title">
          <span aria-hidden="true">01</span>
          <strong>{{ copy.harness }}</strong>
        </div>
        <ul>
          <li v-for="item in copy.harnessItems" :key="item">{{ item }}</li>
        </ul>
      </div>

      <div class="sf-map-rail sf-map-rail--foundation">
        <div class="sf-map-rail-title">
          <span aria-hidden="true">02</span>
          <strong>{{ copy.foundation }}</strong>
        </div>
        <ul>
          <li v-for="item in copy.foundationItems" :key="item">{{ item }}</li>
        </ul>
      </div>
    </div>

    <div class="sf-map-output">
      <span class="sf-map-output-mark" aria-hidden="true">✓</span>
      <strong>{{ copy.output }}</strong>
    </div>

    <figcaption>
      {{ copy.caption }}
    </figcaption>
  </figure>
</template>
