import { assert, expect, test } from 'vitest'
import runCodemod from '../src/index';


test('Math.sqrt()', () => {

  expect(
    runCodemod(['test/mst.example.ts'], { allowJs: true })
  ).toMatchInlineSnapshot('undefined');
})

