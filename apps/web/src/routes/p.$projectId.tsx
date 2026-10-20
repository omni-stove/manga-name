import { m } from '@manga/i18n'
import { Typography, XStack, YStack } from '@manga/ui'
import { createFileRoute, Link, notFound, Outlet, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { BackLinkSlot } from '../back-link'
import { CollaborationBar } from '../collaboration-view'
import { SaveStatusIndicator } from '../save-status'
import { useProject } from '../use-project'
import styles from './project.module.css'

export const Route = createFileRoute('/p/$projectId')({
  loader: async ({ context, params }) => {
    const store = await context.library.open(params.projectId)
    if (!store) throw notFound()
    return { store, collab: context.library.collaboration(params.projectId) }
  },
  component: ProjectLayout,
  notFoundComponent: ProjectNotFound,
})

function ProjectLayout() {
  const { store, collab } = Route.useLoaderData()
  const project = useProject(store)
  const [backLinkSlot, setBackLinkSlot] = useState<HTMLElement | null>(null)
  return (
    <section>
      <XStack wrap gap={24} rowGap={8} className={styles.toolbar}>
        <span ref={setBackLinkSlot} className={styles.backLink} />
        <CollaborationBar collab={collab} project={project} />
        <XStack as="span" gap={6} className={styles.actions}>
          <SaveStatusIndicator store={store} />
        </XStack>
      </XStack>
      <BackLinkSlot value={backLinkSlot}>
        <Outlet />
      </BackLinkSlot>
    </section>
  )
}

function ProjectNotFound() {
  const { projectId } = useParams({ strict: false })
  return (
    <YStack as="section" gap={16} align="start">
      <Typography variant="title">{m.web_not_found_project()}</Typography>
      <Typography>{projectId}</Typography>
      <Link to="/">{m.web_back_to_project_list()}</Link>
    </YStack>
  )
}
