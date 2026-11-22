import unittest
from modal_provider.runner import classify_blender_failure, safe_failure_code


class BlenderFailureClassificationTests(unittest.TestCase):
    def test_python_exception_only_with_trusted_marker(self):
        code,exc,line=classify_blender_failure(
            1,'', 'Traceback: /private/token\n'
            'BW_USER_PYTHON_ERROR type=AttributeError line=142\n')
        self.assertEqual((code,exc,line),('python_script_error','AttributeError',142))
        self.assertEqual(classify_blender_failure(1,'',
            'BW_USER_PYTHON_ERROR type=SecretToken line=22')[0],
            'blender_execution_failed')

    def test_signal_is_not_sufficient_for_oom(self):
        self.assertEqual(classify_blender_failure(137,'','')[0],'blender_crash')
        self.assertEqual(classify_blender_failure(-9,'','')[0],'blender_crash')
        self.assertEqual(classify_blender_failure(1,'','')[0],
                         'blender_execution_failed')
        self.assertEqual(classify_blender_failure(137,'','Out of memory')[0],
                         'out_of_memory')

    def test_provider_timeout_classification(self):
        class Timeout(Exception): pass
        self.assertEqual(safe_failure_code('blender_execution',Timeout('deadline exceeded')),
                         'blender_timeout')
        self.assertEqual(safe_failure_code('modal_start',RuntimeError('quota')),
                         'sandbox_start_failed')


if __name__=='__main__':
    unittest.main()
