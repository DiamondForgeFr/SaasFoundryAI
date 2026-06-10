/**
 * Resources
 */
import { RouteObject } from 'react-router-dom'

/**
 * Dependencies
 */
import { AccountManagement, AccountReactivation, Dashboard, LayoutLogged, PlatformModules, ProfileManagement } from '@/router/lazy-pages'
import { LazyRouteElement } from '@/router/lazy-route-element'
import { AccountDisabledRoute, ModuleAccessRoute, PrivateOnlyRoute } from '@/router/routes-guard'

/**
 * Routes
 *
 * `AccountDisabledRoute` wraps every feature route. When the user has access only to disabled
 * accounts, it redirects them to `/account/reactivation`. `/profile` and `/account/reactivation`
 * sit OUTSIDE the gate so they remain reachable on a disabled account (the user must still be
 * able to update their profile and submit a reactivation request).
 */
export const privateRoutes: RouteObject[] = [
  {
    path: '/',
    element: <PrivateOnlyRoute />,
    children: [
      {
        element: LazyRouteElement(LayoutLogged),
        children: [
          {
            path: 'profile',
            element: <ModuleAccessRoute module="PROFILE_ADMINISTRATION" />,
            children: [
              {
                index: true,
                element: LazyRouteElement(ProfileManagement)
              }
            ]
          },
          {
            path: 'account/reactivation',
            element: LazyRouteElement(AccountReactivation)
          },
          {
            element: <AccountDisabledRoute />,
            children: [
              {
                path: 'dashboard',
                element: LazyRouteElement(Dashboard)
              },
              {
                path: 'account',
                element: <ModuleAccessRoute module="ACCOUNT_ADMINISTRATION" />,
                children: [
                  {
                    index: true,
                    element: LazyRouteElement(AccountManagement)
                  }
                ]
              },
              {
                path: 'platform',
                element: <ModuleAccessRoute module="PLATFORM_ADMINISTRATION" />,
                children: [
                  {
                    path: 'modules',
                    element: LazyRouteElement(PlatformModules)
                  }
                ]
              }
              // Add other protected routes here
            ]
          }
        ]
      }
    ]
  }
]
