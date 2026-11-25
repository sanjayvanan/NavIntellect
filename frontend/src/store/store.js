import { configureStore } from '@reduxjs/toolkit'
import themeReducer from './themeSlice'
import shipReducer from './shipSlice'
import { errorMiddleware } from '../middleware/errorMiddleware'

export const store = configureStore({
  reducer: {
    theme: themeReducer,
    ships: shipReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types
        ignoredActions: ['ships/setSelectedShip'],
        // Ignore these field paths in all actions
        ignoredActionPaths: ['payload.timestamp'],
        // Ignore these paths in the state
        ignoredPaths: ['ships.shipHistory']
      }
    }).concat(errorMiddleware),
  devTools: process.env.NODE_ENV !== 'production',
  devTools: {
    name: 'Ship Tracking App',
    trace: true,
    traceLimit: 25
  }
})

// Add hot reloading in development
if (import.meta.hot) {
  import.meta.hot.accept(['./themeSlice', './shipSlice'], ([
    newThemeModule,
    newShipModule
  ]) => {
    store.replaceReducer({
      theme: newThemeModule?.default,
      ships: newShipModule?.default
    })
  })
} 