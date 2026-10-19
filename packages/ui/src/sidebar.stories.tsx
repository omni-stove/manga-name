import { m } from '@manga/i18n'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn } from 'storybook/test'
import { Sidebar } from './sidebar'
import { Typography } from './typography'

const meta = {
  component: Sidebar,
  args: {
    title: 'インスペクタ',
    side: 'right',
    expanded: true,
    onExpandedChange: fn(),
    children: <Typography>選んだ要素のフォーム</Typography>,
  },
  // 開閉を親が持つ部品なので、操作で開閉が動くよう状態を持たせる
  render: function Render(args) {
    const [expanded, setExpanded] = useState(args.expanded)
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', height: '20rem' }}>
        <Sidebar
          {...args}
          expanded={expanded}
          onExpandedChange={(next) => {
            setExpanded(next)
            args.onExpandedChange(next)
          }}
        />
      </div>
    )
  },
} satisfies Meta<typeof Sidebar>

export default meta
type Story = StoryObj<typeof meta>

export const Expanded: Story = {}

export const Collapsed: Story = { args: { expanded: false } }

export const Left: Story = { args: { side: 'left' } }

// 操作すると開閉が動くので、見た目のストーリーとは分ける
export const ToggleHidesContent: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByText('選んだ要素のフォーム')).toBeVisible()

    await userEvent.click(
      canvas.getByRole('button', { name: m.ui_sidebar_collapse({ title: args.title }) }),
    )
    await expect(args.onExpandedChange).toHaveBeenLastCalledWith(false)
    await expect(canvas.getByText('選んだ要素のフォーム')).not.toBeVisible()
    await expect(canvas.getByRole('complementary', { name: args.title })).toBeVisible()

    await userEvent.click(
      canvas.getByRole('button', { name: m.ui_sidebar_expand({ title: args.title }) }),
    )
    await expect(canvas.getByText('選んだ要素のフォーム')).toBeVisible()
  },
}
