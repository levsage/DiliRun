"""DiliRun asset pipeline package.

Modules
-------
``util``        image + math helpers shared by the pipeline
``segment``     background removal and part extraction from the hero illustration
``rig``         cut-out rig renderer (parts, hinges, keyframe interpolation)
``poses``       the animation library (hand-authored pose data)
``spritesheet`` packing the rendered poses into the runtime sheet + manifest
``brand``       logo tints, app icons, coin sprites
"""

__all__ = ["util", "segment", "rig", "poses", "spritesheet", "brand"]
__version__ = "1.0.0"
