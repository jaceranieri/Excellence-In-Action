#!/usr/bin/env python3
"""
import-eia.py — regenerates ELEMENT_THEMES from a EIA.json-shaped source
file, and prints the JS object literal (var ELEMENT_THEMES = {...};) to
stdout, ready to paste into example.html in place of the existing block.

Usage:
    python3 import-eia.py EIA.json > element_themes.js

This is a one-time-per-update transform, not something the running app
does — see "Importing EIA.json" in README.md for the exact field mapping
and the reasoning behind each choice below.

WHAT THIS DOES NOT DO: it never rewrites, trims, or otherwise touches
any rubric text from the source file — only key names change. It also
does not preserve live state (rubric selections, grades, evidence) from
a previous ELEMENT_THEMES — every Theme comes out fresh (Ungraded, no
selections, no evidence). If you want to carry forward the one worked
example ('Collective belief and responsibility'), or any other live
state, re-apply it after running this script — see the merge step
that was done by hand the first time, documented in README.md.
"""

import json
import sys

# Element display name (as it appears in the source file) -> this app's
# wheel segment id. Keep in sync with excellence-wheel.js's SEGMENTS if
# any Element's wheel id ever changes.
NAME_TO_ID = {
    'Assessment and Feedback': 'assessment-feedback',
    'Know and Engage the Learner': 'know-engage-learner',
    'Safe and Supportive Environment': 'safe-supportive-environment',
    'Collaborative Planning and Programming': 'collaborative-planning',
    'Data Analysis and Decision Making': 'data-analysis',
    'Instructional Coaching': 'instructional-coaching',
    'Differentiation': 'differentiation',
    'Highly Effective Teaching': 'highly-effective-teaching',
    'Intervention': 'intervention',
}

# Source uses an underscore for this one level key; the other three
# ('delivering', 'sustaining', 'excelling') already match this app's
# hyphenated convention used throughout (GRADES, RUBRIC_LEVELS, etc.).
LEVEL_MAP = {'pre_delivering': 'pre-delivering'}
LEVEL_ORDER = ['pre-delivering', 'delivering', 'sustaining', 'excelling']


# A Theme's stable id (used as the key into saved Ratings/EvidenceLog rows)
# is the longest common '_'-joined prefix of its rubric rows' own ids, e.g.
# ["L_CPP_CBR_Vision", "L_CPP_CBR_Leadership"] -> "L_CPP_CBR". Verified
# unique and non-trivial (>=2 segments) across all 36 themes in EIA.json.
def theme_id(rubric_ids):
    parts_list = [i.split('_') for i in rubric_ids]
    minlen = min(len(p) for p in parts_list)
    common = []
    for idx in range(minlen):
        vals = set(p[idx] for p in parts_list)
        if len(vals) != 1:
            break
        common.append(parts_list[0][idx])
    return '_'.join(common)

# Draw order must match excellence-wheel.js's SEGMENTS (clockwise from
# the top) so a rendered dot-ring / card order matches the wheel.
ORDER = [
    'instructional-coaching', 'data-analysis', 'collaborative-planning',
    'highly-effective-teaching', 'differentiation', 'intervention',
    'know-engage-learner', 'safe-supportive-environment', 'assessment-feedback'
]

# This app's detail-panel title differs from the source element_name
# only for this one Element (the wheel's own label wraps to include a
# subtitle the detail panel doesn't want) — every other Element's title
# already matches its element_name exactly via segment.lines.join(' ').
TITLE_OVERRIDE = {'collaborative-planning': 'Collaborative Planning and Programming'}


def transform(source):
    out = {}
    for domain in source:
        for el in domain['elements']:
            seg_id = NAME_TO_ID.get(el['element_name'])
            if not seg_id:
                print('!! unmapped element name: ' + el['element_name'], file=sys.stderr)
                continue
            themes = []
            for th in el['themes']:
                rubric_rows = []
                for r in th['rubrics']:
                    cells = {LEVEL_MAP.get(k, k): v for k, v in r['levels'].items()}
                    rubric_rows.append({'key': r.get('id'), 'selected': None, 'cells': cells})
                themes.append({
                    'title': th['theme_name'],
                    'id': theme_id([r['id'] for r in th['rubrics']]),
                    'grade': 'ungraded',
                    'rubric': rubric_rows,
                    'evidence': []
                })
            out[seg_id] = {'themes': themes}
    return out


def js_str(s):
    # json.dumps' escaping (\, ", \n, unicode) is valid JS string syntax too.
    return json.dumps(s, ensure_ascii=False)


def js_val(v):
    return 'null' if v is None else js_str(v)


def render(out):
    lines = ['var ELEMENT_THEMES = {']
    for i, seg_id in enumerate(ORDER):
        entry = out[seg_id]
        lines.append('  ' + js_str(seg_id) + ': {')
        if seg_id in TITLE_OVERRIDE:
            lines.append('    title: ' + js_str(TITLE_OVERRIDE[seg_id]) + ',')
        lines.append('    themes: [')
        themes = entry['themes']
        for j, th in enumerate(themes):
            lines.append('      {')
            lines.append('        title: ' + js_str(th['title']) + ',')
            lines.append('        id: ' + js_str(th['id']) + ',')
            lines.append('        grade: ' + js_str(th['grade']) + ',')
            lines.append('        rubric: [')
            for k, row in enumerate(th['rubric']):
                key_comment = '  // ' + row['key'] if row.get('key') else ''
                lines.append('          {')
                lines.append('            selected: ' + js_val(row['selected']) + ',')
                lines.append('            cells: {')
                for li, level in enumerate(LEVEL_ORDER):
                    text = row['cells'].get(level, '')
                    comma = ',' if li < len(LEVEL_ORDER) - 1 else ''
                    lines.append('              ' + js_str(level) + ': ' + js_str(text) + comma)
                lines.append('            }')
                lines.append('          }' + (',' if k < len(th['rubric']) - 1 else '') + key_comment)
            lines.append('        ],')
            lines.append('        evidence: []')
            lines.append('      }' + (',' if j < len(themes) - 1 else ''))
        lines.append('    ]')
        lines.append('  }' + (',' if i < len(ORDER) - 1 else ''))
    lines.append('};')
    return '\n'.join(lines)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: python3 import-eia.py EIA.json > element_themes.js', file=sys.stderr)
        sys.exit(1)
    with open(sys.argv[1], encoding='utf-8') as f:
        source_data = json.load(f)
    print(render(transform(source_data)))
