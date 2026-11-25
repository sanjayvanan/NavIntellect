import { configureStore } from '@reduxjs/toolkit'
import themeReducer from './themeSlice'
import shipReducer from './shipSlice'
import authReducer from './authSlice'
import { mapObjectsReducers } from '../features/mapObjects'
import { settingsSync } from './settingsSync'
import { errorMiddleware } from '../middleware/errorMiddleware'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    theme: themeReducer,
    ships: shipReducer,
    ...mapObjectsReducers,
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
    }).prepend(settingsSync.middleware).concat(errorMiddleware),
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
      auth: authReducer,
      theme: newThemeModule?.default,
      ships: newShipModule?.default
    })
  })
} 