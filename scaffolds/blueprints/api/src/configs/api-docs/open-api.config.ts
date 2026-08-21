export const openApiConfig = {
  title: 'SaaSFoundryAI API',
  description: 'An open-source solution for managing clients, invoices, and financial tasks.',
  version: process.env.npm_package_version || '1.0.0',
  contact: {
    name: 'SaaSFoundryAI Team',
    url: 'https://github.com/DiamondForgeFr/SaasFoundryAI',
    email: 'anthony.gachet@diamondforge.fr'
  },
  license: {
    name: 'MIT',
    url: 'https://opensource.org/licenses/MIT'
  },
  outputPath: 'docs/openapi.json'
}
