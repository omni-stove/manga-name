import { createFileRoute, redirect } from '@tanstack/react-router'
import { tour } from '../onboarding/tour'

/**
 * 「はじめに」。オンボーディングの案内を始め、案内の途中なら今の手順の画面へ移る。
 * 案内はこの画面ではなく、移った先の画面に重ねて出す
 */
export const Route = createFileRoute('/onboarding')({
  beforeLoad: async ({ context, preload }) => {
    // ナビの「はじめに」に触れただけの先読みで、案内を始めない
    if (preload) return
    const projectId = tour.state.getState()?.projectId
    const project = projectId ? (await context.library.open(projectId))?.get() : undefined
    tour.resume(project)
    const progress = tour.state.getState()
    if (!project || !progress?.projectId || progress.step === 'project')
      throw redirect({ to: '/new' })
    const params = { projectId: progress.projectId }
    if (progress.step === 'character') throw redirect({ to: '/p/$projectId/characters', params })
    if (progress.pageId)
      throw redirect({
        to: '/p/$projectId/pages/$pageId',
        params: { ...params, pageId: progress.pageId },
      })
    const episodeId = project.episodes[0]?.id
    if (progress.step === 'draft' && episodeId)
      throw redirect({ to: '/p/$projectId/episodes/$episodeId', params: { ...params, episodeId } })
    throw redirect({ to: '/p/$projectId', params })
  },
})
