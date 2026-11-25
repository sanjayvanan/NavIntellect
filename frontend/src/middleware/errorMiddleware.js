export const errorMiddleware = (store) => (next) => (action) => {
  try {
    // Log actions that contain error
    if (action.error) {
      console.error('Error Action:', action)
      // You could also send to an error tracking service here
    }
    
    // Log rejected promises
    if (action.type.endsWith('/rejected')) {
      console.error('API Error:', action.payload)
      // Could trigger a notification system here
    }

    return next(action)
  } catch (err) {
    console.error('Middleware Error:', err)
    throw err
  }
} 