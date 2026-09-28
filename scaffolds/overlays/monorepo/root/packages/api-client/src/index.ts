/**
 * Public surface of `@{{PROJECT_NAME}}/api-client`.
 *
 * Generated React Query hooks live under `./generated/api/<tag>/<tag>.ts`
 * and are emitted by orval — do NOT edit those files by hand. Re-running
 * `npm run codegen` from the monorepo root regenerates the whole
 * `generated/` tree.
 *
 * The mutator + auth hooks are stable and can be edited.
 */

export {
  apiClientMutator,
  setApiBaseUrl,
  setUnauthorizedHandler,
  type ApiClientRequestConfig,
  type BodyType,
  type ErrorType
} from './http-client'
