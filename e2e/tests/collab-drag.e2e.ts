import { expect, type Page, test } from '@playwright/test'
import { FIXTURE_PROJECT, importProject, openPage, selectTool } from './app'

const bubbleBox = async (page: Page, id: string) => {
  const box = await page.locator(`[data-bubble-id="${id}"]`).boundingBox()
  if (!box) throw new Error(`bubble ${id} is not rendered`)
  return box
}

test('2 つのタブで別々のフキダシを同時にドラッグしても、両方の移動が残る', async ({
  context,
  page: alice,
}) => {
  await importProject(alice, FIXTURE_PROJECT)
  await openPage(alice, 1)
  const bob = await context.newPage()
  await bob.goto(alice.url())
  for (const page of [alice, bob]) {
    await expect(
      page.getByRole('list', { name: '開いている人' }).getByRole('listitem'),
    ).toHaveCount(2)
    await selectTool(page, 'フキダシ')
  }

  // 1 コマ目と 3 コマ目のフキダシ。同じページの bubbles を 2 人が同時に書き換える
  const before = {
    first: await bubbleBox(alice, 'bb_1'),
    third: await bubbleBox(alice, 'bb_3'),
  }
  const grab = async (page: Page, id: string) => {
    const box = await bubbleBox(page, id)
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    return at
  }
  const a = await grab(alice, 'bb_1')
  const b = await grab(bob, 'bb_3')
  const steps = 8
  for (let i = 1; i <= steps; i++) {
    await alice.mouse.move(a.x - (40 * i) / steps, a.y)
    await bob.mouse.move(b.x, b.y + (30 * i) / steps)
  }
  await Promise.all([alice.mouse.up(), bob.mouse.up()])

  for (const page of [alice, bob]) {
    await expect(async () => {
      const first = await bubbleBox(page, 'bb_1')
      const third = await bubbleBox(page, 'bb_3')
      expect(first.x - before.first.x).toBeLessThan(-20)
      expect(Math.abs(first.y - before.first.y)).toBeLessThan(2)
      expect(third.y - before.third.y).toBeGreaterThan(15)
      expect(Math.abs(third.x - before.third.x)).toBeLessThan(2)
    }).toPass()
  }
})
