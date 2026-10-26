import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { Layout } from './components/Layout'
import { DataPage } from './routes/data'
import { ForecastPage } from './routes/forecast'
import { ModelDetailPage } from './routes/model-detail'
import { ModelsPage } from './routes/models'
import { OverviewPage } from './routes/overview'
import { TrainPage } from './routes/train'

const rootRoute = createRootRoute({ component: Layout })

const overview = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: OverviewPage,
})
const data = createRoute({ getParentRoute: () => rootRoute, path: '/data', component: DataPage })
const train = createRoute({ getParentRoute: () => rootRoute, path: '/train', component: TrainPage })
const models = createRoute({
  getParentRoute: () => rootRoute,
  path: '/models',
  component: ModelsPage,
})
export const modelDetail = createRoute({
  getParentRoute: () => rootRoute,
  path: '/models/$modelId',
  component: ModelDetailPage,
})
export const forecast = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forecast',
  component: ForecastPage,
  validateSearch: (s: Record<string, unknown>): { model?: string } =>
    typeof s.model === 'string' ? { model: s.model } : {},
})

const routeTree = rootRoute.addChildren([overview, data, train, models, modelDetail, forecast])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
