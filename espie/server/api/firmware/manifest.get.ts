export default defineEventHandler(async (event) => {
  return sendRedirect(event, '/api/firmware/boards', 301)
})
