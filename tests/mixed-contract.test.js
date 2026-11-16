import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mixedOutputSchema,validateMixedOutput} from '../src/validators.js';
import {rerunSelection} from '../src/rerun.js';
import {selectKits} from '../src/catalog.js';

test('the mixed prompt schema declares the same numeric step and test array that validation requires',()=>{
  const schema=mixedOutputSchema(1);assert.equal(schema.properties.step.type,'integer');assert.equal(schema.properties.step.const,1);assert.equal(schema.properties.tests.type,'array');assert.equal(schema.properties.tests.minItems,3);
  const data={step:1,screenplay_facts:[],inventory_value_cents:0,code_risks:[],change_plan:[],tests:['First test','Second test','Third test']};
  assert.equal(validateMixedOutput(JSON.stringify(data),1).passed,true);
  assert.equal(validateMixedOutput(JSON.stringify({...data,step:'6-1'}),1).passed,false);
  assert.equal(validateMixedOutput(JSON.stringify({...data,step:2}),1).passed,false);
  assert.equal(validateMixedOutput(JSON.stringify({...data,tests:{a:1,b:2,c:3}}),1).passed,false);
  assert.equal(validateMixedOutput(JSON.stringify({...data,tests:['First test']}),1).passed,false);
  const missing={...data};delete missing.code_risks;assert.equal(validateMixedOutput(JSON.stringify(missing),1).passed,false);
});
test('targeted reruns reuse prerequisites, refresh consumers and reject invalid or out-of-plan kits',()=>{
  const plan=selectKits('03');assert.deepEqual(rerunSelection('03,03',plan,true),['03-prose-summary-short']);assert.deepEqual(rerunSelection('all',plan,true),['01-prose-short','03-prose-summary-short']);assert.deepEqual(rerunSelection(undefined,plan,false),[]);
  assert.deepEqual(rerunSelection('01',plan,true),['01-prose-short','03-prose-summary-short']);assert.deepEqual(rerunSelection('06',selectKits('all'),true),['06-json-generation','07-json-prefill','12-mixed-iterations']);assert.deepEqual(rerunSelection('12',selectKits('all'),true),['12-mixed-iterations']);
  assert.throws(()=>rerunSelection('03',plan,false),/requires --resume/);assert.throws(()=>rerunSelection('05',plan,true),/outside the original/);assert.throws(()=>rerunSelection('99',plan,true),/Unknown/);assert.throws(()=>rerunSelection('',plan,true),/nonempty/);
});
