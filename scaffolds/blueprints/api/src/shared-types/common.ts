/**
 * ISO-8601 datetime as it crosses the wire. Stored as a string in JSON
 * payloads; `Date` is allowed so backend code that holds Date objects
 * before serialization can still satisfy the contract.
 */
export type IsoDateString = string | Date

export interface Collection<T> {
  count: number
  values: T[]
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: PaginationMeta
}
