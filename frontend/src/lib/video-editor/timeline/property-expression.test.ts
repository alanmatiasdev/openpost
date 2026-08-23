import { describe, expect, it, vi } from 'vitest';
import { evaluatePropertyExpression, isExpressionValueCompatible } from './property-expression';

const context = {
	preValue: 10,
	globalFrame: 30,
	fps: 30,
	resolveProperty: vi.fn((itemId: string, property: string) =>
		itemId === 'source' && property === 'x' ? 20 : null
	)
};

describe('property expression sandbox', () => {
	it('evaluates deterministic arithmetic, time, frame, and property references', () => {
		expect(
			evaluatePropertyExpression('value + prop("source", "x") * time + frame', context)
		).toEqual({ value: 60 });
	});

	it('supports component-wise vector arithmetic and lerp', () => {
		const result = evaluatePropertyExpression('lerp(value, [100, 200], 0.5)', {
			...context,
			preValue: { x: 0, y: 20 }
		});
		expect(result).toEqual({ value: { x: 50, y: 110 } });
		expect(isExpressionValueCompatible('position', result.value)).toBe(true);
		expect(isExpressionValueCompatible('x', result.value)).toBe(false);
	});

	it('implements the full bounded math catalog', () => {
		expect(
			evaluatePropertyExpression(
				'min(max(abs(-4), 3), 8) + clamp(20, 0, 5) + sin(0) + cos(0)',
				context
			)
		).toEqual({ value: 10 });
	});

	it('falls back to the pre-expression value with useful errors', () => {
		expect(evaluatePropertyExpression('value / 0', context)).toEqual({
			value: 10,
			error: 'Division by zero'
		});
		expect(evaluatePropertyExpression('window.alert(1)', context).error).toMatch(
			/invalid number|unexpected character/i
		);
		expect(evaluatePropertyExpression('prop("missing", "x")', context).error).toBe(
			'Property reference is unavailable'
		);
	});

	it('rejects unbounded source, token, and nesting input', () => {
		expect(evaluatePropertyExpression('1'.repeat(2049), context).error).toBe(
			'Expression is too long'
		);
		expect(
			evaluatePropertyExpression(Array.from({ length: 513 }, () => '1').join('+'), context).error
		).toBe('Expression has too many tokens');
		expect(evaluatePropertyExpression(`${'('.repeat(65)}1${')'.repeat(65)}`, context).error).toBe(
			'Expression is too deeply nested'
		);
	});
});
