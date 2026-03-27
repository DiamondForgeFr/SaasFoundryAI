# {{PROJECT_NAME}} Web

Production-ready React application generated with **SaaSFoundry** - An AI-First development platform.

## Tech Stack

- **Frontend**: React 19, React Router v7, Vite 7
- **Styling**: TailwindCSS 4, Radix UI, ShadCN UI
- **State**: React Query (data fetching), React Hook Form (forms)
- **Validation**: Zod 4
- **i18n**: i18next (French + English)
- **Testing**: Playwright (E2E)

## Project Structure

```
src/
├── components/
│   ├── layout/       # App layout components
│   ├── nav/          # Navigation components
│   └── ui/           # ShadCN UI components
├── pages/
│   ├── private/      # Protected pages (require auth)
│   └── public/       # Public pages (login, register)
├── hooks/
│   ├── api/          # React Query hooks for API calls
│   └── ui/           # UI-related hooks
├── router/
│   ├── routes.tsx    # Route definitions
│   ├── lazy-pages.tsx  # Lazy-loaded page components
│   └── guard.tsx     # Route protection (auth)
├── locales/          # i18next translations (YAML)
│   ├── en/
│   └── fr/
└── utils/            # Utility functions
```

## Code Conventions

### Component Pattern
```tsx
// PascalCase for components
export function UserProfile() {
  // React Query for data fetching
  const { data: user } = useGetUser()

  // React Hook Form for forms
  const form = useForm<UserFormData>({
    resolver: zodResolver(userSchema)
  })

  return <div>...</div>
}
```

### Path Aliases
- `@/*` → `./src/*`

### Styling
- **TailwindCSS** for utility classes
- **ShadCN** for pre-built components
- **Radix UI** for accessible primitives
- Mobile-first responsive design

### API Integration
- React Query hooks in `src/hooks/api/`
- Axios for HTTP requests
- Automatic token refresh
- Type-safe with TypeScript

## Git Workflow

- Main branch: `master`
- **ALWAYS** use conventional commits: `<type>(#<ticket>): <description>`
- Types: feat, fix, docs, style, refactor, perf, test, chore
- Scope (ticket number) is required
- Max header: 100 characters
- Husky enforces commit format + pre-push checks

### Commit Examples
```bash
feat(#42): add user profile page
fix(#43): resolve form validation issue
style(#44): improve mobile responsiveness
```

## Development Commands

```bash
# Development
npm run dev                 # Start Vite dev server (port 5173)

# Testing
npm run test:e2e            # Run Playwright E2E tests
npm run test:full           # Format + Lint + Type-check + E2E

# Code Quality
npm run format              # Prettier
npm run lint                # ESLint
npm run type-check          # TypeScript

# Build
npm run build               # Production build
npm run preview             # Preview production build
```

## 🤖 AI-Assisted Development

This project is pre-configured for AI development with Claude Code.

### 🛠️ Available Skills

Located in `.claude/skills/`:

#### Git Workflows
- **`/git-commit`** - Quick commit with conventional messages
  - Auto-generates commit messages following project conventions
  - Includes ticket number and proper type

- **`/git-fix-pr-comments`** - Implement PR review feedback
  - Fetches PR comments from GitHub
  - Implements requested changes automatically
  - Creates new commits with fixes

#### Code Quality
- **`/utils-fix-errors`** - Fix ESLint and TypeScript errors
  - Parallel processing for fast fixes
  - Respects project conventions
  - Safe refactoring

- **`/utils-fix-grammar`** - Fix grammar and spelling
  - Preserves code formatting
  - Works on markdown, comments, docs

### 🎯 Common AI Workflows

#### Implement a new page
```
User: "Add a user settings page with form validation"
Claude:
1. Creates page component in src/pages/private/
2. Adds route in router/routes.tsx
3. Creates form with React Hook Form + Zod
4. Adds i18n translations
5. Implements API hook for saving settings
```

#### Fix styling issues
```
User: "Make this page responsive for mobile"
Claude:
- Analyzes current layout
- Adds Tailwind responsive classes (sm:, md:, lg:)
- Tests on different breakpoints
```

#### Add translations
```
User: "Add French translation for the login page"
Claude:
- Updates src/locales/fr/auth.yml
- Ensures translation keys match English version
- Uses i18next best practices
```

### ✅ Best Practices

**DO**:
- Trust the skills - they respect project conventions
- Let AI handle repetitive tasks (commits, error fixes, translations)
- Use ShadCN components for consistency
- Review UI/UX choices manually

**DON'T**:
- Skip tests - E2E tests validate user flows
- Bypass git hooks (`--no-verify`)
- Ignore TypeScript errors
- Hard-code strings (use i18next)

### 🔒 Quality Gates

All AI-generated code passes through:
- **ESLint** - Code quality standards (React hooks rules)
- **TypeScript** - Compile-time type safety
- **Prettier** - Consistent code formatting
- **Playwright** - E2E user flow validation
- **Git hooks** - Pre-commit checks
- **CI/CD** - Automated deployment validation

## Routing

### Protected Routes
```tsx
// Requires authentication
<Route element={<ProtectedLayout />}>
  <Route path="/dashboard" element={<Dashboard />} />
  <Route path="/profile" element={<UserProfile />} />
</Route>
```

### Public Routes
```tsx
// No authentication required
<Route path="/login" element={<Login />} />
<Route path="/register" element={<Register />} />
```

### Lazy Loading
```tsx
// Automatic code splitting
const Dashboard = lazy(() => import('./pages/private/Dashboard'))
```

## Internationalization (i18n)

### Using Translations
```tsx
import { useTranslation } from 'react-i18next'

function LoginPage() {
  const { t } = useTranslation('auth')

  return <h1>{t('login.title')}</h1>
}
```

### Translation Files
```yaml
# src/locales/en/auth.yml
login:
  title: "Sign In"
  email: "Email Address"
  password: "Password"
```

## Environment Variables

See `.env.example` for required variables:

```bash
# API Configuration
VITE_API_URL="http://localhost:3000/api"

# Optional: Analytics
VITE_ANALYTICS_URL="..."
VITE_ANALYTICS_WEBSITE_ID="..."

# Optional: Storage
VITE_STORAGE_ENABLED="true"
```

## Testing

### E2E Tests (Playwright)
```bash
npm run test:e2e
# Tests full user flows in real browser
# Located in: tests/e2e/*.spec.ts
```

### Writing Tests
```typescript
test('user can login', async ({ page }) => {
  await page.goto('/login')
  await page.fill('[name="email"]', 'user@example.com')
  await page.fill('[name="password"]', 'password')
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL('/dashboard')
})
```

## Important Notes

- This is a **generated project** from SaaSFoundry v{{VERSION}}
- Check `.saasfoundry.json` for installed modules and configuration
- Update this CLAUDE.md as your project evolves
- Add new components to ShadCN collection as needed

---

**Need help?** Check the [SaaSFoundry documentation](https://github.com/DiamondForgeFr/SaaSFoundry) or use Claude Code skills for assistance.
