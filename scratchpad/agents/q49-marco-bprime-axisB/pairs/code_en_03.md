# Pair `code_en_03`

Category: `code`  
Prompt language (do not infer arms from this): `en`

Judge: pick `winner=A` or `winner=B` or `winner=tie` or `winner=undecidable`. Do not try to guess which model is which. Prefer the response that better follows the prompt (correctness, language of the prompt, format, no loops).

## Prompt

Write a JavaScript function sumEvens(arr) that returns the sum of even numbers in an array of integers. Code only, no explanation, no markdown fences.

## Response A

function sumEvens(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] % 2 === 0) {
      sum += arr[i];
    }
  }
  return sum;
}

## Response B

function sumEvens(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] % 2 === 0) {
      sum += arr[i];
    }
  }
  return sum;
}
