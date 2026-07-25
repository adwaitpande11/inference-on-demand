import unittest
from unittest.mock import MagicMock, patch

from api.providers.aws_ec2 import AWSEC2Provider


class AWSEC2ProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = AWSEC2Provider()

    @patch("api.providers.aws_ec2.boto3.client")
    def test_launch_instance_uses_config_values(self, mock_client: MagicMock) -> None:
        mock_ec2 = MagicMock()
        mock_client.return_value = mock_ec2
        mock_ec2.run_instances.return_value = {"Instances": [{"InstanceId": "i-123456"}]}

        config = {
            "ami_id": "ami-123",
            "instance_type": "t3.micro",
            "subnet_id": "subnet-123",
            "security_group_id": "sg-123",
        }

        handle = self.provider.launch_instance(config)

        self.assertEqual(handle, "i-123456")
        mock_ec2.run_instances.assert_called_once()
        kwargs = mock_ec2.run_instances.call_args.kwargs
        self.assertEqual(kwargs["ImageId"], "ami-123")
        self.assertEqual(kwargs["InstanceType"], "t3.micro")
        self.assertEqual(kwargs["SubnetId"], "subnet-123")
        self.assertEqual(kwargs["SecurityGroupIds"], ["sg-123"])

    @patch("api.providers.aws_ec2.boto3.client")
    def test_terminate_instance_uses_tag_lookup(self, mock_client: MagicMock) -> None:
        mock_ec2 = MagicMock()
        mock_client.return_value = mock_ec2
        mock_ec2.describe_instances.return_value = {
            "Reservations": [
                {
                    "Instances": [
                        {
                            "InstanceId": "i-654321",
                            "State": {"Name": "running"},
                            "Tags": [{"Key": "ManagedBy", "Value": "inference-on-demand"}],
                        }
                    ]
                }
            ]
        }

        self.provider.terminate_instance("ignored-handle")

        mock_ec2.describe_instances.assert_called_once()
        filters = mock_ec2.describe_instances.call_args.kwargs["Filters"]
        self.assertIn({"Name": "tag:ManagedBy", "Values": ["inference-on-demand"]}, filters)
        mock_ec2.terminate_instances.assert_called_once_with(InstanceIds=["i-654321"])

    @patch("api.providers.aws_ec2.boto3.client")
    def test_get_state_returns_lowercase_state(self, mock_client: MagicMock) -> None:
        mock_ec2 = MagicMock()
        mock_client.return_value = mock_ec2
        mock_ec2.describe_instances.return_value = {
            "Reservations": [
                {
                    "Instances": [
                        {
                            "InstanceId": "i-111",
                            "State": {"Name": "RUNNING"},
                            "Tags": [{"Key": "ManagedBy", "Value": "inference-on-demand"}],
                        }
                    ]
                }
            ]
        }

        state = self.provider.get_state("ignored-handle")

        self.assertEqual(state, "running")


if __name__ == "__main__":
    unittest.main()
