// `sf new` writes the project's name and description here; add a `contact` block if the API publishes one
export const openApiConfig = {
  title: 'SaaSFoundryAI API',
  description: 'An open-source solution for managing clients, invoices, and financial tasks.',
  version: process.env.npm_package_version || '1.0.0',
  license: {
    name: 'MIT',
    url: 'https://opensource.org/licenses/MIT'
  },
  outputPath: 'docs/openapi.json'
}
